import { deriveUndoAffectedKeys } from "../core/sidebar-undo-service.js";

function snapshotsDiffer(before, after) {
  return deriveUndoAffectedKeys(before, after).length > 0;
}

async function markCompositeUnavailable(transaction) {
  if (typeof transaction.failApplied === "function") {
    await transaction.failApplied().catch(() => undefined);
  }
}

async function commitCompositeOrMarkUnavailable(
  transaction,
  primaryAfter,
  companionAfter
) {
  try {
    return await transaction.commitComposite(primaryAfter, companionAfter);
  } catch {
    await markCompositeUnavailable(transaction);
    return transaction.finalization ?? {
      unavailable: true,
      applied: true,
      summary: null
    };
  }
}

// Removes several workspaces as one action: the other browsing scope's runtime
// follows each removal, and a composite transaction captures both scopes once
// before and once after, so the whole batch is a single Undo entry. A failure
// part way keeps what was applied and still records it, so Undo can restore it.
async function removeWorkspacesTogether(
  primary,
  secondary,
  operationExecutor,
  windowId,
  workspaceIds,
  decorations,
  transaction
) {
  return operationExecutor.runExclusive(async (lease) => {
    const composite = transaction?.composite === true;
    let beforePrimary = null;
    let beforeCompanion = null;
    if (composite) {
      beforePrimary = await primary.captureSidebarUndoSnapshot(windowId, lease);
      beforeCompanion = await secondary.captureSidebarUndoSnapshot(null, lease);
      await transaction.prepareComposite(beforePrimary, beforeCompanion);
    }
    let failure = null;
    let removedCount = 0;
    try {
      const order = await primary.prepareWorkspaceBatchRemoval(workspaceIds, decorations, lease);
      for (const workspaceId of order) {
        const rollbackToken = await secondary.prepareWorkspaceRemoval(workspaceId, lease);
        try {
          await primary.removeWorkspaceWithLease(windowId, workspaceId, null, lease);
        } catch (error) {
          await secondary.restorePreparedWorkspaceState(rollbackToken, lease).catch(() => undefined);
          throw error;
        }
        removedCount += 1;
      }
    } catch (error) {
      failure = error;
    }
    if (composite) {
      const primaryAfter = await primary.captureSidebarUndoSnapshot(windowId, lease)
        .catch(() => null);
      const companionAfter = primaryAfter === null
        ? null
        : await secondary.captureSidebarUndoSnapshot(null, lease).catch(() => null);
      if (primaryAfter === null || companionAfter === null) {
        await markCompositeUnavailable(transaction);
      } else if (
        !snapshotsDiffer(beforePrimary, primaryAfter) &&
        !snapshotsDiffer(beforeCompanion, companionAfter)
      ) {
        await transaction.abort().catch(() => undefined);
      } else {
        await commitCompositeOrMarkUnavailable(transaction, primaryAfter, companionAfter);
      }
    }
    if (failure) {
      failure.removedCount = removedCount;
      throw failure;
    }
    return removedCount;
  });
}

export function withSharedWorkspaceRemoval(primary, secondary, operationExecutor) {
  return new Proxy(primary, {
    get(target, property) {
      if (property === "removeWorkspaces") {
        return (windowId, workspaceIds, decorations, transaction = null) =>
          removeWorkspacesTogether(
            target,
            secondary,
            operationExecutor,
            windowId,
            workspaceIds,
            decorations,
            transaction
          );
      }
      if (property !== "removeWorkspace") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }

      return async (windowId, workspaceId, ...rest) => {
        const transaction = rest[0] ?? null;
        if (transaction?.composite !== true) {
          const token = await secondary.prepareWorkspaceRemoval(workspaceId);
          try {
            return await target.removeWorkspace(windowId, workspaceId, ...rest);
          } catch (error) {
            await secondary.restorePreparedWorkspaceState(token).catch(() => undefined);
            throw error;
          }
        }

        return operationExecutor.runExclusive(async (lease) => {
          const beforePrimary = await target.captureSidebarUndoSnapshot(windowId, lease);
          const beforeCompanion = await secondary.captureSidebarUndoSnapshot(null, lease);
          await transaction.prepareComposite(beforePrimary, beforeCompanion);
          let rollbackToken = null;
          let primaryAfter = null;
          let primaryUndoUnavailable = false;
          const controllerTransaction = Object.freeze({
            prepare: async () => true,
            commit: async (snapshot) => {
              primaryAfter = snapshot;
              return { unavailable: false, applied: true };
            },
            abort: async () => false,
            failApplied: async () => {
              primaryUndoUnavailable = true;
              return { unavailable: true, applied: true };
            }
          });

          let result;
          try {
            rollbackToken = await secondary.prepareWorkspaceRemoval(workspaceId, lease);
            result = await target.removeWorkspaceWithLease(
              windowId,
              workspaceId,
              controllerTransaction,
              lease
            );
          } catch (error) {
            if (
              primaryAfter !== null &&
              snapshotsDiffer(beforePrimary, primaryAfter)
            ) {
              const companionAfter = await secondary.captureSidebarUndoSnapshot(null, lease)
                .catch(() => null);
              if (companionAfter === null) {
                await markCompositeUnavailable(transaction);
              } else {
                await commitCompositeOrMarkUnavailable(
                  transaction,
                  primaryAfter,
                  companionAfter
                );
              }
            } else if (primaryUndoUnavailable) {
              await markCompositeUnavailable(transaction);
            } else {
              if (rollbackToken) {
                await secondary.restorePreparedWorkspaceState(rollbackToken, lease)
                  .catch(() => undefined);
              }
              await transaction.abort().catch(() => undefined);
            }
            throw error;
          }

          if (primaryUndoUnavailable || primaryAfter === null) {
            await markCompositeUnavailable(transaction);
            return result;
          }
          const companionAfter = await secondary.captureSidebarUndoSnapshot(null, lease)
            .catch(() => null);
          if (companionAfter === null) {
            await markCompositeUnavailable(transaction);
            return result;
          }
          await commitCompositeOrMarkUnavailable(transaction, primaryAfter, companionAfter);
          return result;
        });
      };
    }
  });
}
