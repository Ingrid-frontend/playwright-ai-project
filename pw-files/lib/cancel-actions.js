function cancelRepoPipeline(session) {
  session.repoPipelineCancelled = true;
  if (session.repoPipelineProc) {
    try {
      session.repoPipelineProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoPipelineProc = null;
  }
}

function cancelRepoTest(session) {
  session.repoTestCancelled = true;
  if (session.repoTestProc) {
    try {
      session.repoTestProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoTestProc = null;
  }
}

function cancelRepoBatch(session) {
  session.repoBatchCancelled = true;
  if (session.repoTestProc) {
    try {
      session.repoTestProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoTestProc = null;
  }
}

function cancelRepoCompare(session) {
  session.repoCompareCancelled = true;
  if (session.repoCompareProc) {
    try {
      session.repoCompareProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoCompareProc = null;
  }
}

function cancelAiValidate(session) {
  session.aiValidateCancelled = true;
  if (session.aiValidateProc) {
    try {
      session.aiValidateProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.aiValidateProc = null;
  }
}

function cancelIntentRun(session) {
  session.intentRunCancelled = true;
  if (session.intentRunProc) {
    try {
      session.intentRunProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.intentRunProc = null;
  }
}

function cancelEgoAudit(session) {
  session.egoAuditCancelled = true;
  if (session.egoAuditProc) {
    try {
      session.egoAuditProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.egoAuditProc = null;
  }
}

function cancelEgoExplore(session) {
  session.egoExploreCancelled = true;
  if (session.egoExploreProc) {
    try {
      session.egoExploreProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.egoExploreProc = null;
  }
}

function cancelRepoRerun(session) {
  session.repoRerunCancelled = true;
  if (session.repoRerunProc) {
    try {
      session.repoRerunProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoRerunProc = null;
  }
}

function cancelOptimize(session) {
  session.optimizeCancelled = true;
}

function cancelRun(session) {
  session.runCancelled = true;
  if (session.runProc) {
    try {
      session.runProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.runProc = null;
  }
}

module.exports = {
  cancelRepoPipeline,
  cancelRepoTest,
  cancelRepoBatch,
  cancelRepoCompare,
  cancelAiValidate,
  cancelIntentRun,
  cancelEgoAudit,
  cancelEgoExplore,
  cancelRepoRerun,
  cancelOptimize,
  cancelRun,
};
