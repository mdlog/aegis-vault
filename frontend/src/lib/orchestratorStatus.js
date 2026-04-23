export function getOrchestratorExecutorAddresses(status) {
  if (Array.isArray(status?.executorAddresses) && status.executorAddresses.length > 0) {
    return status.executorAddresses.filter(Boolean);
  }

  return status?.executorAddress ? [status.executorAddress] : [];
}

export function getPrimaryOrchestratorExecutor(status) {
  return getOrchestratorExecutorAddresses(status)[0] || '';
}

export function formatOrchestratorExecutorSummary(status) {
  const executorAddresses = getOrchestratorExecutorAddresses(status);
  if (executorAddresses.length === 0) return '';
  if (executorAddresses.length === 1) return executorAddresses[0];
  return `${executorAddresses[0]} (+${executorAddresses.length - 1} more)`;
}

export function doesExecutorMatchOrchestrator(status, executorAddress) {
  if (!executorAddress) return false;
  const target = executorAddress.toLowerCase();
  return getOrchestratorExecutorAddresses(status).some(
    (address) => address.toLowerCase() === target
  );
}
