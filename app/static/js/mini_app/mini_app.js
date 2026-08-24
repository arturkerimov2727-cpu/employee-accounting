const telegram = window.Telegram?.WebApp;
const miniState = { data: null, period: "month" };
const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

function initials(name = "") { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function time(value) { return value ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) : "—"; }
function duration(minutes = 0) { return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`; }
function dateLabel(value) { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`)); }

async function request(path, body = {}) {
  if (!telegram?.initData) throw new Error("Откройте приложение из Telegram, чтобы подтвердить аккаунт.");
  const response = await fetch(`/api/miniapp${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, init_data: telegram.initData }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Сервис временно недоступен. Попробуйте ещё раз.");
  return data;
}

function setError(error) { document.querySelector("#loading").hidden = true; document.querySelector("#app").hidden = true; document.querySelector("#error").hidden = false; document.querySelector("#error-text").textContent = error.message || "Не удалось получить данные."; }
function renderDay(day) {
  const atWork = day.state === "open_shift";
  document.querySelector("#status").textContent = atWork ? "Вы на работе" : day.state === "completed" ? "Смена завершена" : day.state === "absence" ? day.absenceLabel : day.state === "day_off" ? "Выходной" : "Смена не начата";
  document.querySelector("#status-dot").classList.toggle("working", atWork);
  document.querySelector("#status-detail").textContent = atWork ? `С ${time(day.in)}` : day.isOpen ? "Незавершённая смена" : "";
  document.querySelector("#shift-duration").textContent = day.workedMinutes ? duration(day.workedMinutes) : "";
  document.querySelector("#today-schedule").textContent = day.schedule.isWorkday ? `${day.schedule.startsAt} — ${day.schedule.endsAt}` : "Выходной";
  document.querySelector("#schedule-state").textContent = day.absenceLabel || "";
  document.querySelector("#arrival").textContent = time(day.in); document.querySelector("#departure").textContent = time(day.out); document.querySelector("#worked").textContent = day.workedMinutes ? duration(day.workedMinutes) : "—";
  const note = document.querySelector("#attendance-note");
  const messages = [day.lateMinutes && `Опоздание: ${day.lateMinutes} мин`, day.earlyLeaveMinutes && `Ранний уход: ${day.earlyLeaveMinutes} мин`, day.overtimeMinutes && `Переработка: ${duration(day.overtimeMinutes)}`].filter(Boolean);
  note.hidden = !messages.length; note.textContent = messages.join(" · ");
  document.querySelector(".attendance.in").disabled = atWork || !["scheduled", "completed"].includes(day.state) && day.state !== "scheduled";
  document.querySelector(".attendance.out").disabled = !atWork;
}
function renderHistory(items) { document.querySelector("#history").innerHTML = items.slice(0, 30).map((day) => `<article class="history-item"><div class="history-head"><strong>${dateLabel(day.date)}</strong><span>${day.absenceLabel || (day.state === "day_off" ? "Выходной" : day.state === "absent" ? "Отсутствие" : day.state === "open_shift" ? "Незавершённая смена" : "Смена")}</span></div><div class="history-meta">${day.in ? `<span>Приход: ${time(day.in)}</span>` : ""}${day.out ? `<span>Уход: ${time(day.out)}</span>` : ""}${day.workedMinutes ? `<span>Отработано: ${duration(day.workedMinutes)}</span>` : ""}${day.lateMinutes ? `<span class="tag warn">Опоздание: ${day.lateMinutes} мин</span>` : ""}${day.overtimeMinutes ? `<span class="tag">Переработка: ${duration(day.overtimeMinutes)}</span>` : ""}</div></article>`).join("") || "<p>Истории пока нет.</p>"; }
function renderSchedule(schedule) { document.querySelector("#schedule-list").innerHTML = schedule.map((row) => `<article class="schedule-row ${row.isWorkday ? "" : "off"}"><strong>${weekdays[row.weekday]}</strong><span>${row.isWorkday ? `${row.startsAt} — ${row.endsAt}` : "Выходной"}</span></article>`).join(""); }
function renderStats(stats, period) { const names = [["Количество смен", stats.shifts], ["Рабочее время", duration(stats.workedMinutes)], ["Средняя смена", duration(stats.averageShiftMinutes)], ["Опоздания", `${stats.lateCount} · ${stats.lateMinutes} мин`], ["Ранние уходы", `${stats.earlyLeaveCount} · ${stats.earlyLeaveMinutes} мин`], ["Переработка", duration(stats.overtimeMinutes)], ["Пропущенные дни", stats.missedWorkdays], ["Разрешённые отсутствия", stats.approvedAbsences]]; document.querySelector("#stats-period").textContent = `${dateLabel(period.from)} — ${dateLabel(period.to)}`; document.querySelector("#stat-list").innerHTML = names.map(([name, value]) => `<div class="stat-row"><span>${name}</span><strong>${value}</strong></div>`).join(""); }
function render(data) { miniState.data = data; const employee = data.employee; document.querySelector("#avatar").textContent = initials(employee.fullName); document.querySelector("#full-name").textContent = employee.fullName; document.querySelector("#position").textContent = employee.position; document.querySelector("#department").textContent = employee.department; document.querySelector("#today-date").textContent = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date()); renderDay(data.today); renderHistory(data.history); renderSchedule(data.schedule); document.querySelector("#loading").hidden = true; document.querySelector("#app").hidden = false; }
async function load() { try { render(await request("/me")); await loadStats(); } catch (error) { setError(error); } }
async function loadStats() { const data = await request("/statistics", { period: miniState.period }); renderStats(data.statistics, data.period); }

document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button)); document.querySelectorAll("[data-panel]").forEach((panel) => panel.hidden = panel.dataset.panel !== button.dataset.tab); }));
document.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", async () => { miniState.period = button.dataset.period; document.querySelectorAll("[data-period]").forEach((item) => item.classList.toggle("active", item === button)); try { await loadStats(); } catch (error) { setError(error); } }));
document.querySelectorAll("[data-event]").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; try { const data = await request(`/attendance/${button.dataset.event}`); telegram?.showPopup?.({ message: data.message }); renderDay(data.today); const refreshed = await request("/me"); render(refreshed); } catch (error) { telegram?.showAlert?.(error.message); setError(error); } finally { button.disabled = false; } }));
document.querySelector("#retry").addEventListener("click", () => { document.querySelector("#error").hidden = true; document.querySelector("#loading").hidden = false; load(); });
telegram?.ready(); telegram?.expand(); load();
