/* Chart.js rendering only. Data is passed in so this module stays independent of app state. */
window.AttendanceCharts = (() => {
  function cssVar(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }
  function label(day, weekday = false) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", ...(weekday ? { weekday: "short" } : {}), timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)); }
  function makeChart(canvasId, type, labels, datasets, options = {}) {
    const canvas = document.querySelector(`#${canvasId}`);
    if (!canvas || typeof Chart === "undefined") return null;
    return new Chart(canvas, { type, data: { labels, datasets }, options: {
      responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
      plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: options.timeAxis ? { label: (context) => `${context.dataset.label}: ${String(Math.floor(context.raw / 60)).padStart(2, "0")}:${String(context.raw % 60).padStart(2, "0")}` } : {} } },
      scales: { x: { grid: { display: false }, ticks: { color: cssVar("--chart-text", "#5f6f85"), font: { size: 9 } } }, y: { beginAtZero: !options.timeAxis, min: options.timeAxis ? 420 : undefined, max: options.timeAxis ? 1200 : undefined, grid: { color: cssVar("--chart-grid", "#e4eaf2") }, ticks: { color: cssVar("--chart-text", "#5f6f85"), font: { size: 9 }, callback: options.timeAxis ? (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:00` : undefined } } }
    }});
  }
  function averageEventMinutes(events, day, eventType, timeZone) {
    const values = events
      .filter((event) => event.eventType === eventType)
      .filter((event) => AttendanceTime.dateKey(event.eventTime, timeZone) === day)
      .map((event) => AttendanceTime.minutesOfDay(event.eventTime, timeZone));
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  }
  function drawHoursChart(canvasId, days, hours) {
    return makeChart(canvasId, "bar", days.map((day) => label(day, true)), [{ label: "Рабочие часы", data: hours.map((value) => Math.round(value)), backgroundColor: hours.map((_, index) => index === hours.length - 1 ? cssVar("--chart-blue", "#2276e6") : cssVar("--chart-blue-soft", "#8bbcf5")), borderRadius: 5 }]);
  }
  function drawAttendanceSummary(canvasId, total, arrived, notArrived) {
    return makeChart(canvasId, "bar", ["Всего", "Пришли", "Не пришли"], [{ label: "Сотрудники", data: [total, arrived, notArrived], backgroundColor: [cssVar("--chart-blue", "#2276e6"), cssVar("--chart-green", "#18a957"), cssVar("--chart-orange", "#ef6f21")], borderRadius: 6 }]);
  }
  function drawAttendanceCharts(hoursCanvas, timeCanvas, days, hours, events, timeZone) {
    return [
      makeChart(hoursCanvas, "bar", days.map((day) => label(day)), [{ label: "Часы", data: hours.map((value) => Math.round(value * 10) / 10), backgroundColor: cssVar("--chart-blue", "#2276e6"), borderRadius: 5 }]),
      makeChart(timeCanvas, "line", days.map((day) => label(day)), [{ label: "Приход", data: days.map((day) => averageEventMinutes(events, day, "IN", timeZone)), borderColor: cssVar("--chart-green", "#18a957"), backgroundColor: cssVar("--chart-green-soft", "rgba(24, 169, 87, .18)"), tension: .35 }, { label: "Уход", data: days.map((day) => averageEventMinutes(events, day, "OUT", timeZone)), borderColor: cssVar("--chart-orange", "#ef6f21"), backgroundColor: cssVar("--chart-orange-soft", "rgba(239, 111, 33, .18)"), tension: .35 }], { timeAxis: true })
    ].filter(Boolean);
  }
  return { makeChart, drawHoursChart, drawAttendanceSummary, drawAttendanceCharts };
})();
