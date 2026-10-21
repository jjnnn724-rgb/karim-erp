function formatHours(value, digits = 1) {
  const hours = Number(value || 0);
  if (!Number.isFinite(hours) || hours <= 0) {
    return `0.${'0'.repeat(digits)} ساعة`;
  }
  return `${hours.toFixed(digits)} ساعة`;
}

function formatLateSummary({ totalMinutes = 0, lateDays: _lateDays = 0 } = {}) {
  const minutes = Number(totalMinutes || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '—';
  }
  return `${formatHours(minutes / 60, 1)} <small>(${Math.round(minutes)} دقيقة)</small>`;
}

function formatLateRow({ lateMinutes = 0, lateDays = 0 } = {}) {
  const minutes = Number(lateMinutes || 0);
  const days = Number(lateDays || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '—';
  }
  return `${days > 0 ? days : 0} يوم <small>(${Math.round(minutes)} دقيقة)</small>`;
}

module.exports = { formatHours, formatLateSummary, formatLateRow };
