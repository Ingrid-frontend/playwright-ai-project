function createJobsHandlers(ctx) {
  const {
    handleJobsList,
    handleJobsStatus,
    handleJobsPreview,
    handleJobsRun,
    handleJobsStop,
  } = ctx;

  return {
    'jobs:list': async (ws) => {
      await handleJobsList(ws);
    },
    'jobs:status': async (ws, _session, _sessionId, msg) => {
      await handleJobsStatus(ws, msg);
    },
    'jobs:preview': async (ws, _session, _sessionId, msg) => {
      await handleJobsPreview(ws, msg);
    },
    'jobs:run': async (ws, _session, _sessionId, msg) => {
      await handleJobsRun(ws, msg);
    },
    'jobs:stop': async (ws, _session, _sessionId, msg) => {
      await handleJobsStop(ws, msg);
    },
  };
}

module.exports = { createJobsHandlers };
