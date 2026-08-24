/* Chart.js rendering only. Data is passed in so this module stays independent of app state. */
window.AttendanceCharts = (() => {
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function label(day, weekday = false) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", ...(weekday ? { weekday: "short" } : {}), timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)); }
  function makeChart(canvasId, type, labels, datasets, options = {}) {
    const canvas = document.querySelector(`#${canvasId}`);
    if (!canvas || typeof Chart === "undefined") return null;
    return new Chart(canvas, { type, data: { labels, datasets }, options: {
      responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
      plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: options.timeAxis ? { label: (context) => `${context.dataset.label}: ${String(Math.floor(context.raw / 60)).padStart(2, "0")}:${String(context.raw % 60).padStart(2, "0")}` } : {} } },
      scales: { x: { grid: { display: false }, ticks: { color: cssVar("--chart-text"), font: { size: 9 } } }, y: { beginAtZero: !options.timeAxis, min: options.timeAxis ? 420 : undefined, max: options.timeAxis ? 1200 : undefined, grid: { color: cssVar("--chart-grid") }, ticks: { color: cssVar("--chart-text"), font: { size: 9 }, callback: options.timeAxis ? (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:00` : undefined } } }
    }});
  }
  function averageEventMinutes(events, day, eventType) {
    const values = events.filter((event) => event.eventType === eventType && event.eventTime.slice(0, 10) === day).map((event) => { const [hour, minute] = event.eventTime.slice(11, 16).split(":").map(Number); return hour * 60 + minute; });
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  }
  function drawHoursChart(canvasId, days, hours) {
    return makeChart(canvasId, "bar", days.map((day) => label(day, true)), [{ label: "Рабочие часы", data: hours.map((value) => Math.round(value)), backgroundColor: hours.map((_, index) => index === hours.length - 1 ? cssVar("--chart-blue") : cssVar("--chart-blue-soft")), borderRadius: 5 }]);
  }
  function drawAttendanceCharts(hoursCanvas, timeCanvas, days, hours, events) {
    return [
      makeChart(hoursCanvas, "bar", days.map((day) => label(day)), [{ label: "Часы", data: hours.map((value) => Math.round(value * 10) / 10), backgroundColor: cssVar("--chart-blue"), borderRadius: 5 }]),
      makeChart(timeCanvas, "line", days.map((day) => label(day)), [{ label: "Приход", data: days.map((day) => averageEventMinutes(events, day, "IN")), borderColor: cssVar("--chart-green"), backgroundColor: cssVar("--chart-green-soft"), tension: .35 }, { label: "Уход", data: days.map((day) => averageEventMinutes(events, day, "OUT")), borderColor: cssVar("--chart-orange"), backgroundColor: cssVar("--chart-orange-soft"), tension: .35 }], { timeAxis: true })
    ].filter(Boolean);
  }
  return { makeChart, drawHoursChart, drawAttendanceCharts };
})();
