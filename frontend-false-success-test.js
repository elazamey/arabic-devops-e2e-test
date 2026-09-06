// Browser-run regression tests for the frontend false-success guard.
// Run after loading arabic-devops-agent.html in a real browser context.
(function installFalseSuccessTests() {
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const state = () => document.getElementById('plan-status').dataset.state;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  window.runRifaaFalseSuccessTests = async function runRifaaFalseSuccessTests() {
    const originalFetch = window.fetch;
    const results = [];
    const record = (id, status) => results.push({ id, status });

    try {
      window.eval('backendOnline = false; setUIState("NO_BACKEND");');
      document.getElementById('confirm-modal').click();
      await wait(20);
      assert(state() !== 'COMPLETED', 'NO_BACKEND reached COMPLETED');
      record('backend-unavailable-not-completed', 'PASS');

      for (const offlineState of ['DEMO', 'OFFLINE']) {
        window.eval(`backendOnline = false; setUIState("${offlineState}");`);
        document.getElementById('confirm-modal').click();
        await wait(20);
        assert(state() === offlineState, `${offlineState} changed unexpectedly`);
        assert(state() !== 'COMPLETED', `${offlineState} reached COMPLETED`);
        record(`${offlineState.toLowerCase()}-not-completed`, 'PASS');
      }

      window.eval('backendOnline = true; setUIState("PLANNED");');
      window.__rifaaInvalidBackendResult = { state: 'COMPLETED', result: {} };
      window.__rifaaMissingEvidence = null;
      const invalidAccepted = window.eval('finishMergeUI(__rifaaInvalidBackendResult, __rifaaMissingEvidence)');
      assert(invalidAccepted === false, 'Missing execution proof was accepted');
      assert(state() !== 'COMPLETED', 'Missing execution proof reached COMPLETED');
      record('backend-response-without-proof-not-completed', 'PASS');

      window.eval('setUIState("PLANNED");');
      window.__rifaaValidBackendResult = {
        state: 'COMPLETED',
        result: { executionId: 'test-execution-id', verification: 'VERIFIED' }
      };
      window.__rifaaValidEvidence = {
        id: 'test-evidence-id',
        type: 'EXECUTION',
        result: 'SUCCESS',
        executionId: 'test-execution-id',
        timestamp: new Date().toISOString()
      };
      const validAccepted = window.eval('finishMergeUI(__rifaaValidBackendResult, __rifaaValidEvidence)');
      assert(validAccepted === true, 'Valid backend proof was rejected');
      await wait(1500);
      assert(state() === 'COMPLETED', 'Valid backend proof did not reach COMPLETED');
      assert(!document.body.textContent.includes('test-execution-id'), 'Execution ID was displayed in the UI fixture');
      assert(!document.body.textContent.includes('test-evidence-id'), 'Evidence ID was displayed in the UI fixture');
      record('backend-execution-and-evidence-completes', 'PASS');

      return { status: 'PASS', results };
    } finally {
      window.fetch = originalFetch;
      window.eval('backendOnline = false; setUIState("NO_BACKEND");');
      delete window.__rifaaInvalidBackendResult;
      delete window.__rifaaMissingEvidence;
      delete window.__rifaaValidBackendResult;
      delete window.__rifaaValidEvidence;
    }
  };
})();
