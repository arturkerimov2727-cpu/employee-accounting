const dom = {
  content: document.querySelector("#app-content"),
  pageTitle: document.querySelector("#page-title"),
  sidebar: document.querySelector("#sidebar"),
  backdrop: document.querySelector("#backdrop"),
  drawer: document.querySelector("#drawer"),
  modal: document.querySelector("#modal"),
  toast: document.querySelector("#toast"),
  authGate: document.querySelector("#auth-gate"),
  authChecking: document.querySelector("#auth-checking"),
  authLogin: document.querySelector("#auth-login"),
  authMessage: document.querySelector("#auth-message"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeIcon: document.querySelector("#theme-icon"),
};

const todayKey = new Date().toISOString().slice(0, 10);
const monthStart = `${todayKey.slice(0, 7)}-01`;
const state = {
  data: null,
  view: location.hash.slice(1) || "dashboard",
  charts: [],
  filters: { query: "", employee: "", department: "", status: "", from: todayKey, to: todayKey },
};

const titles = {
  dashboard: "Система учёта сотрудников",
  employees: "Сотрудники",
  attendance: "Посещения",
  reports: "Отчёты",
  charts: "Графики",
  departments: "Отделы",
  settings: "Настройки",
  audit: "Журнал событий",
  users: "Пользователи",
};

function applyTheme(theme, save = true) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  dom.themeToggle.checked = nextTheme === "dark";
  dom.themeIcon.textContent = nextTheme === "dark" ? "☀" : "☾";
  document.querySelector('meta[name="theme-color"]').content = nextTheme === "dark" ? "#0c1119" : "#ffffff";
  if (save) {
    try { localStorage.setItem("attendance-theme", nextTheme); } catch (_) { /* preference storage may be unavailable */ }
  }
  document.body.classList.add("theme-changing");
  clearTimeout(applyTheme.timer);
  applyTheme.timer = setTimeout(() => document.body.classList.remove("theme-changing"), 380);
  if (state.data) render();
}

function safeSignInPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/login";
}

function showSignInGate(path) {
  dom.authMessage.textContent = "Подтвердите аккаунт, чтобы открыть сотрудников, посещения и отчёты";
  dom.authChecking.hidden = true;
  dom.authLogin.hidden = false;
  dom.authLogin.dataset.path = safeSignInPath(path);
}

async function unlockApp() {
  dom.authMessage.textContent = "Доступ подтверждён. Загружаем рабочее пространство";
  dom.authChecking.querySelector("b").textContent = "Вход выполнен";
  dom.authGate.classList.add("approved");
  await new Promise((resolve) => setTimeout(resolve, 450));
  document.body.classList.remove("auth-pending");
  document.body.classList.add("auth-ready");
  dom.authGate.classList.add("leaving");
  setTimeout(() => { dom.authGate.hidden = true; }, 420);
}

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "С";
}

function formatDate(value, options = {}) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", ...options, timeZone: "UTC" }).format(date);
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

function durationLabel(minutes) {
  if (minutes === null || Number.isNaN(minutes)) return "—";
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)} ч ${String(safe % 60).padStart(2, "0")} мин`;
}

function minutesBetween(start, end) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

function employeeSessions(employeeId, from = "0000-01-01", to = "9999-12-31") {
  const events = state.data.events
    .filter((event) => Number(event.employeeId) === Number(employeeId))
    .filter((event) => event.eventTime.slice(0, 10) >= from && event.eventTime.slice(0, 10) <= to)
    .sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  const days = new Map();
  events.forEach((event) => {
    const day = event.eventTime.slice(0, 10);
    if (!days.has(day)) days.set(day, { date: day, in: null, out: null, minutes: null });
    const row = days.get(day);
    if (event.eventType === "IN" && !row.in) row.in = event.eventTime;
    if (event.eventType === "OUT" && row.in) row.out = event.eventTime;
  });
  return [...days.values()].map((row) => ({
    ...row,
    minutes: row.in && row.out ? minutesBetween(row.in, row.out) : null,
    status: row.in && !row.out ? "На работе" : row.out ? "Ушёл" : "Нет данных",
  })).sort((a, b) => b.date.localeCompare(a.date));
}

function todayRecord(employeeId) {
  return employeeSessions(employeeId, todayKey, todayKey)[0] || { date: todayKey, in: null, out: null, minutes: null, status: "Нет данных" };
}

function workingMinutes(row) {
  if (row.minutes !== null) return row.minutes;
  if (row.in && !row.out && row.date === todayKey) return minutesBetween(row.in, new Date().toISOString());
  return 0;
}

function allTodayRows() {
  return state.data.employees.map((employee) => ({ ...employee, record: todayRecord(employee.id) }));
}

function avatar(name) {
  return `<span class="avatar">${escapeHtml(initials(name))}</span>`;
}

function statusBadge(status) {
  const cls = status === "На работе" ? "working" : status === "Ушёл" ? "left" : "absent";
  return `<span class="status ${cls}">${escapeHtml(status)}</span>`;
}

function employeeOptions(selected = "") {
  return `<option value="">Все</option>${state.data.employees.map((employee) =>
    `<option value="${employee.id}" ${String(employee.id) === String(selected) ? "selected" : ""}>${escapeHtml(employee.fullName)}</option>`).join("")}`;
}

function departmentOptions(selected = "") {
  return `<option value="">Все</option>${state.data.departments.map((department) =>
    `<option value="${department.id}" ${String(department.id) === String(selected) ? "selected" : ""}>${escapeHtml(department.name)}</option>`).join("")}`;
}

function filtersHtml({ monthly = false } = {}) {
  const filters = state.filters;
  return `<div class="filters">
    <label class="search-filter">Поиск<div class="search-control"><input id="filter-query" value="${escapeHtml(filters.query)}" placeholder="Поиск по сотруднику..."><span>⌕</span></div></label>
    <label>Сотрудник<select id="filter-employee">${employeeOptions(filters.employee)}</select></label>
    <label>Отдел<select id="filter-department">${departmentOptions(filters.department)}</select></label>
    <label>Период<div class="split-dates"><input id="filter-from" type="date" value="${monthly ? monthStart : filters.from}"><input id="filter-to" type="date" value="${filters.to}"></div></label>
    <label>Статус<select id="filter-status"><option value="">Все</option><option ${filters.status === "На работе" ? "selected" : ""}>На работе</option><option ${filters.status === "Ушёл" ? "selected" : ""}>Ушёл</option><option ${filters.status === "Нет данных" ? "selected" : ""}>Нет данных</option></select></label>
    <button class="button" id="reset-filters" type="button">Сбросить</button>
    <button class="button primary" id="apply-filters" type="button">Применить</button>
  </div>`;
}

function readFilters() {
  state.filters = {
    query: document.querySelector("#filter-query")?.value.trim() || "",
    employee: document.querySelector("#filter-employee")?.value || "",
    department: document.querySelector("#filter-department")?.value || "",
    status: document.querySelector("#filter-status")?.value || "",
    from: document.querySelector("#filter-from")?.value || todayKey,
    to: document.querySelector("#filter-to")?.value || todayKey,
  };
}

function filteredRows() {
  const filters = state.filters;
  return state.data.employees.map((employee) => {
    const sessions = employeeSessions(employee.id, filters.from, filters.to);
    const record = sessions[0] || { in: null, out: null, minutes: null, status: "Нет данных" };
    return { ...employee, record, sessions, totalMinutes: sessions.reduce((sum, row) => sum + workingMinutes(row), 0) };
  }).filter((row) => {
    const haystack = `${row.fullName} ${row.department} ${row.position}`.toLowerCase();
    return (!filters.query || haystack.includes(filters.query.toLowerCase()))
      && (!filters.employee || String(row.id) === String(filters.employee))
      && (!filters.department || String(row.departmentId) === String(filters.department))
      && (!filters.status || row.record.status === filters.status);
  });
}

function tableHtml(rows, { period = false } = {}) {
  if (!rows.length) return `<div class="empty">По заданным фильтрам ничего не найдено</div>`;
  return `<div class="table-wrap"><table><thead><tr>
    <th>Сотрудник</th><th>Отдел</th><th>Приход</th><th>Уход</th><th>Время</th><th>Статус</th><th></th>
  </tr></thead><tbody>${rows.map((row) => `<tr class="clickable" data-employee-id="${row.id}">
    <td><span class="employee-cell">${avatar(row.fullName)}<span><strong>${escapeHtml(row.fullName)}</strong><small>${escapeHtml(row.position)}</small></span></span></td>
    <td>${escapeHtml(row.department)}</td>
    <td>${formatTime(row.record.in)}</td><td>${formatTime(row.record.out)}</td>
    <td>${period ? durationLabel(row.totalMinutes) : durationLabel(row.record.minutes)}</td>
    <td>${statusBadge(row.record.status)}</td><td><button class="icon-button" aria-label="Открыть карточку">•••</button></td>
  </tr>`).join("")}</tbody></table></div><div class="table-footer"><span>Показано: ${rows.length}</span><span>Всего сотрудников: ${state.data.employees.length}</span></div>`;
}

function lastDays(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (count - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function totalForDay(day) {
  return state.data.employees.reduce((sum, employee) => {
    const row = employeeSessions(employee.id, day, day)[0];
    return sum + (row ? workingMinutes(row) : 0);
  }, 0);
}

function renderDashboard() {
  const rows = allTodayRows();
  const working = rows.filter((row) => row.record.status === "На работе");
  const arrived = rows.filter((row) => row.record.in);
  const left = rows.filter((row) => row.record.out);
  const totalMinutes = rows.reduce((sum, row) => sum + workingMinutes(row.record), 0);
  dom.content.innerHTML = `<section class="metrics">
    ${metric("green", "♙", "На работе", working.length, "сейчас в офисе")}
    ${metric("blue", "⇥", "Пришли сегодня", arrived.length, "за день")}
    ${metric("orange", "⇤", "Ушли сегодня", left.length, "за день")}
    ${metric("purple", "◷", "Рабочих часов", `${Math.round(totalMinutes / 60)} ч`, "сегодня")}
  </section>
  <section class="dashboard-grid">
    <article class="panel"><div class="panel-head"><h3>Рабочие часы по дням</h3><select class="input" id="chart-period"><option value="7">Последние 7 дней</option><option value="14">Последние 14 дней</option></select></div><div class="chart-wrap"><canvas id="hours-chart"></canvas></div></article>
    <article class="panel"><div class="panel-head"><h3>Кто сейчас на работе</h3><button class="text-button" data-go="attendance">Все (${working.length}) ›</button></div><div class="working-list">${working.slice(0, 6).map((row) => `<button class="working-row" data-employee-id="${row.id}">${avatar(row.fullName)}<span><strong>${escapeHtml(row.fullName)}</strong><small>${escapeHtml(row.department)}</small></span><span class="working-time"><strong>${formatTime(row.record.in)}</strong><small>Пришёл</small></span><i class="working-dot"></i></button>`).join("") || `<div class="empty">Сейчас на работе никого нет</div>`}</div></article>
  </section>
  <section class="panel">${filtersHtml()}<div id="filtered-table">${tableHtml(filteredRows())}</div></section>`;
  bindFilters();
  bindRows();
  drawHoursChart(7);
  document.querySelector("#chart-period")?.addEventListener("change", (event) => drawHoursChart(Number(event.target.value)));
}

function metric(color, icon, label, value, sub) {
  return `<article class="metric-card ${color}"><span class="metric-icon">${icon}</span><div><span>${label}</span><strong>${value}</strong><small>${sub}</small></div></article>`;
}

function renderEmployees() {
  const query = state.filters.query.toLowerCase();
  const rows = state.data.employees.filter((employee) => `${employee.fullName} ${employee.department} ${employee.position}`.toLowerCase().includes(query));
  dom.content.innerHTML = `<div class="page-head"><div><h2>Сотрудники</h2><p>Карточки и контактные данные сотрудников</p></div><div class="page-actions"><button class="button primary" id="add-employee">＋ Добавить сотрудника</button></div></div>
    <section class="panel"><div class="filters"><label class="search-filter">Поиск<div class="search-control"><input id="employee-search" value="${escapeHtml(state.filters.query)}" placeholder="ФИО, отдел или должность"><span>⌕</span></div></label><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <div id="employee-table">${tableHtml(rows.map((employee) => ({ ...employee, record: todayRecord(employee.id) })))}</div></section>`;
  document.querySelector("#add-employee").addEventListener("click", () => openEmployeeModal());
  document.querySelector("#employee-search").addEventListener("input", (event) => {
    state.filters.query = event.target.value;
    const nextQuery = state.filters.query.toLowerCase();
    const nextRows = state.data.employees
      .filter((employee) => `${employee.fullName} ${employee.department} ${employee.position}`.toLowerCase().includes(nextQuery))
      .map((employee) => ({ ...employee, record: todayRecord(employee.id) }));
    document.querySelector("#employee-table").innerHTML = tableHtml(nextRows);
    bindRows();
  });
  bindRows();
}

function renderAttendance() {
  const events = state.data.events.slice(0, 300);
  dom.content.innerHTML = `<div class="page-head"><div><h2>Посещения</h2><p>Точный журнал приходов и уходов</p></div><div class="page-actions"><button class="button primary" id="add-event">＋ Записать событие</button></div></div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Дата и время</th><th>Сотрудник</th><th>Отдел</th><th>Событие</th><th>Источник</th><th>Комментарий</th></tr></thead><tbody>${events.map((event) => `<tr class="clickable" data-employee-id="${event.employeeId}"><td>${formatDate(event.eventTime)} ${formatTime(event.eventTime)}</td><td><span class="employee-cell">${avatar(event.employeeName)}<strong>${escapeHtml(event.employeeName)}</strong></span></td><td>${escapeHtml(event.department)}</td><td>${event.eventType === "IN" ? `<span class="status working">⇥ Приход</span>` : `<span class="status left">⇤ Уход</span>`}</td><td>${escapeHtml(event.source)}</td><td>${escapeHtml(event.comment || "—")}</td></tr>`).join("")}</tbody></table></div><div class="table-footer"><span>Последние ${Math.min(events.length, 300)} событий</span></div></section>`;
  document.querySelector("#add-event").addEventListener("click", openEventModal);
  bindRows();
}

function renderReports() {
  state.filters.from = state.filters.from === todayKey ? monthStart : state.filters.from;
  const rows = filteredRows();
  const totalMinutes = rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  const shifts = rows.reduce((sum, row) => sum + row.sessions.filter((session) => session.out).length, 0);
  const average = shifts ? totalMinutes / shifts : 0;
  dom.content.innerHTML = `<div class="page-head"><div><h2>Отчёты</h2><p>Рабочее время за выбранный период</p></div><div class="page-actions"><button class="button" id="export-csv">↓ Экспорт CSV</button></div></div>
    <section class="report-cards"><article class="mini-card"><small>Всего часов</small><strong>${durationLabel(totalMinutes)}</strong><p>${formatDate(state.filters.from)} по ${formatDate(state.filters.to)}</p></article><article class="mini-card"><small>Завершённых смен</small><strong>${shifts}</strong><p>По всем сотрудникам</p></article><article class="mini-card"><small>Средняя смена</small><strong>${durationLabel(average)}</strong><p>Без незавершённых смен</p></article></section>
    <section class="panel">${filtersHtml({ monthly: true })}<div id="filtered-table">${tableHtml(rows, { period: true })}</div></section>`;
  bindFilters();
  bindRows();
  document.querySelector("#export-csv").addEventListener("click", () => exportCsv(rows));
}

function renderCharts() {
  dom.content.innerHTML = `<div class="page-head"><div><h2>Графики</h2><p>Динамика часов и времени прихода</p></div></div><section class="split"><article class="panel"><div class="panel-head"><div><h3>Рабочие часы</h3><p>За последние 14 дней</p></div></div><div class="chart-wrap tall"><canvas id="monthly-chart"></canvas></div></article><article class="panel"><div class="panel-head"><div><h3>Среднее время</h3><p>Приход и уход по дням</p></div></div><div class="chart-wrap tall"><canvas id="time-chart"></canvas></div></article></section>`;
  const days = lastDays(14);
  makeChart("monthly-chart", "bar", days.map(shortDay), [{ label: "Часы", data: days.map((day) => Math.round(totalForDay(day) / 60 * 10) / 10), backgroundColor: "#3d8cf1", borderRadius: 5 }]);
  const arrivals = days.map((day) => averageEventMinutes(day, "IN"));
  const departures = days.map((day) => averageEventMinutes(day, "OUT"));
  makeChart("time-chart", "line", days.map(shortDay), [{ label: "Приход", data: arrivals, borderColor: "#1aa65c", backgroundColor: "#1aa65c22", tension: .35 }, { label: "Уход", data: departures, borderColor: "#ef7a2d", backgroundColor: "#ef7a2d22", tension: .35 }], { timeAxis: true });
}

function renderDepartments() {
  dom.content.innerHTML = `<div class="page-head"><div><h2>Отделы</h2><p>Структура организации и численность</p></div><div class="page-actions"><button class="button primary" id="add-department">＋ Добавить отдел</button></div></div><section class="department-grid">${state.data.departments.map((department) => `<article class="mini-card department-card"><span class="metric-icon">♧</span><div><small>Подразделение</small><strong>${escapeHtml(department.name)}</strong><p>${department.employeeCount} сотрудников</p></div></article>`).join("")}</section>`;
  document.querySelector("#add-department").addEventListener("click", openDepartmentModal);
}

function renderSettings() {
  const settings = state.data.settings;
  dom.content.innerHTML = `<div class="page-head"><div><h2>Настройки</h2><p>Основные параметры системы учёта</p></div></div><section class="panel"><form class="settings-form" id="settings-form"><label class="wide">Название организации<input name="organization" value="${escapeHtml(settings.organization || "")}" required></label><label>Начало рабочего дня<input name="workday_start" type="time" value="${escapeHtml(settings.workday_start || "09:00")}" required></label><label>Конец рабочего дня<input name="workday_end" type="time" value="${escapeHtml(settings.workday_end || "18:00")}" required></label><label class="wide">Часовой пояс<select name="timezone"><option ${settings.timezone === "Europe/Moscow" ? "selected" : ""}>Europe/Moscow</option><option ${settings.timezone === "Etc/UTC" ? "selected" : ""}>Etc/UTC</option><option ${settings.timezone === "Europe/Amsterdam" ? "selected" : ""}>Europe/Amsterdam</option></select></label><footer><button class="button primary" type="submit">Сохранить настройки</button></footer></form></section>`;
  document.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api({ action: "updateSettings", settings: values }, "Настройки сохранены");
  });
}

function renderAudit() {
  dom.content.innerHTML = `<div class="page-head"><div><h2>Журнал событий</h2><p>История действий администраторов</p></div></div><section class="panel"><div class="audit-list">${state.data.audit.length ? state.data.audit.map((item) => `<article class="audit-item"><time>${formatDate(item.createdAt)}<br>${formatTime(item.createdAt)}</time><div><strong>${escapeHtml(item.details || item.action)}</strong><small>${escapeHtml(item.entityType)}${item.entityId ? ` #${item.entityId}` : ""}</small></div><small>${escapeHtml(item.actor)}</small></article>`).join("") : `<div class="empty">Журнал пока пуст</div>`}</div></section>`;
}

function roleLabel(role) {
  return ({ admin: "Администратор", manager: "Руководитель", viewer: "Наблюдатель" })[role] || role;
}

function userStatus(status) {
  const labels = { pending: "Ожидает", active: "Активен", disabled: "Отключён" };
  const cls = status === "active" ? "working" : status === "pending" ? "left" : "absent";
  return `<span class="status ${cls}">${labels[status] || status}</span>`;
}

async function renderUsers() {
  if (state.data.user?.role !== "admin") {
    dom.content.innerHTML = `<section class="error-state"><h2>Недостаточно прав</h2><p>Управление пользователями доступно только администратору.</p></section>`;
    return;
  }
  dom.content.innerHTML = `<section class="loading-state"><span class="spinner"></span><h2>Загружаем пользователей</h2></section>`;
  try {
    const response = await fetch("/api/users", { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Не удалось загрузить пользователей");
    dom.content.innerHTML = `<div class="page-head"><div><h2>Пользователи</h2><p>Заявки на регистрацию и права доступа</p></div></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Пользователь</th><th>Email</th><th>Роль</th><th>Статус</th><th>Регистрация</th><th>Действия</th></tr></thead><tbody>${data.users.map((item) => `<tr><td><span class="employee-cell">${avatar(item.fullName)}<strong>${escapeHtml(item.fullName)}</strong></span></td><td>${escapeHtml(item.email)}</td><td><select class="user-role" data-user-id="${item.id}"><option value="viewer" ${item.role === "viewer" ? "selected" : ""}>Наблюдатель</option><option value="manager" ${item.role === "manager" ? "selected" : ""}>Руководитель</option><option value="admin" ${item.role === "admin" ? "selected" : ""}>Администратор</option></select></td><td>${userStatus(item.status)}</td><td>${formatDate(item.createdAt)}</td><td><div class="user-actions">${item.status === "active" ? `<button class="button user-update" data-user-id="${item.id}" data-status="active">Сохранить роль</button>` : `<button class="button success user-update" data-user-id="${item.id}" data-status="active">Одобрить</button>`}${item.status !== "disabled" ? `<button class="button danger user-update" data-user-id="${item.id}" data-status="disabled">Отключить</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div><div class="table-footer"><span>Всего: ${data.users.length}</span><span>Ожидают: ${data.users.filter((item) => item.status === "pending").length}</span></div></section>`;
    document.querySelectorAll(".user-update").forEach((button) => button.addEventListener("click", async () => {
      const id = Number(button.dataset.userId);
      const role = document.querySelector(`.user-role[data-user-id="${id}"]`).value;
      await updateUser(id, button.dataset.status, role);
    }));
  } catch (error) {
    dom.content.innerHTML = `<section class="error-state"><h2>Не удалось загрузить пользователей</h2><p>${escapeHtml(error.message)}</p></section>`;
  }
}

function render() {
  if (!state.data) return;
  state.charts.forEach((chart) => chart.destroy());
  state.charts = [];
  dom.pageTitle.textContent = titles[state.view] || titles.dashboard;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  const renderer = { dashboard: renderDashboard, employees: renderEmployees, attendance: renderAttendance, reports: renderReports, charts: renderCharts, departments: renderDepartments, settings: renderSettings, audit: renderAudit, users: renderUsers }[state.view] || renderDashboard;
  renderer();
  dom.content.focus();
}

function bindFilters() {
  document.querySelector("#apply-filters")?.addEventListener("click", () => { readFilters(); render(); });
  document.querySelector("#reset-filters")?.addEventListener("click", () => {
    state.filters = { query: "", employee: "", department: "", status: "", from: todayKey, to: todayKey };
    render();
  });
  document.querySelector("#filter-query")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { readFilters(); render(); } });
}

function bindRows() {
  document.querySelectorAll("[data-employee-id]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("button")?.classList.contains("working-row")) return;
    showEmployee(Number(row.dataset.employeeId));
  }));
  document.querySelectorAll("button.working-row").forEach((button) => button.addEventListener("click", () => showEmployee(Number(button.dataset.employeeId))));
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.go)));
}

function showEmployee(id) {
  const employee = state.data.employees.find((item) => Number(item.id) === Number(id));
  if (!employee) return;
  const today = todayRecord(id);
  const month = employeeSessions(id, monthStart, todayKey);
  const monthMinutes = month.reduce((sum, row) => sum + workingMinutes(row), 0);
  dom.drawer.innerHTML = `<button class="drawer-close" type="button" aria-label="Закрыть">×</button><section class="profile">${avatar(employee.fullName)}<h2>${escapeHtml(employee.fullName)}</h2><p>${escapeHtml(employee.position)} · ${escapeHtml(employee.department)}</p>${statusBadge(today.status)}</section><section class="detail-grid"><div class="detail-cell"><small>ПРИХОД</small><strong>${formatTime(today.in)}</strong></div><div class="detail-cell"><small>УХОД</small><strong>${formatTime(today.out)}</strong></div><div class="detail-cell"><small>СЕГОДНЯ</small><strong>${durationLabel(workingMinutes(today))}</strong></div><div class="detail-cell"><small>ЗА МЕСЯЦ</small><strong>${durationLabel(monthMinutes)}</strong></div><div class="detail-cell"><small>ТЕЛЕФОН</small><strong>${escapeHtml(employee.phone || "—")}</strong></div><div class="detail-cell"><small>РАБОТАЕТ С</small><strong>${formatDate(employee.hiredAt)}</strong></div></section><h3>Последние смены</h3>${month.slice(0, 6).map((row) => `<p class="shift-row"><span>${formatDate(row.date)}</span><strong>${formatTime(row.in)} → ${formatTime(row.out)}</strong></p>`).join("") || `<div class="empty">Смен пока нет</div>`}<div class="drawer-actions"><button class="button primary" id="edit-employee">✎ Изменить</button>${today.status === "На работе" ? `<button class="button orange" id="quick-event">⇤ Отметить уход</button>` : `<button class="button success" id="quick-event">⇥ Отметить приход</button>`}<button class="button danger" id="archive-employee">В архив</button></div>`;
  openOverlay("drawer");
  dom.drawer.querySelector(".drawer-close").addEventListener("click", closeOverlay);
  dom.drawer.querySelector("#edit-employee").addEventListener("click", () => openEmployeeModal(employee));
  dom.drawer.querySelector("#quick-event").addEventListener("click", () => quickEvent(employee, today.status === "На работе" ? "OUT" : "IN"));
  dom.drawer.querySelector("#archive-employee").addEventListener("click", async () => {
    if (!confirm(`Переместить сотрудника «${employee.fullName}» в архив?`)) return;
    await api({ action: "archiveEmployee", id: employee.id }, "Сотрудник перемещён в архив");
    closeOverlay();
  });
}

function openEmployeeModal(employee = null) {
  closeOverlay();
  dom.modal.innerHTML = `<div class="modal-head"><h2>${employee ? "Изменить сотрудника" : "Новый сотрудник"}</h2><button class="icon-button modal-close" type="button">×</button></div><form class="form-grid" id="employee-form"><label class="wide">ФИО<input name="fullName" value="${escapeHtml(employee?.fullName || "")}" required></label><label>Отдел<select name="departmentId" required><option value="">Выберите отдел</option>${state.data.departments.map((department) => `<option value="${department.id}" ${Number(employee?.departmentId) === Number(department.id) ? "selected" : ""}>${escapeHtml(department.name)}</option>`).join("")}</select></label><label>Должность<input name="position" value="${escapeHtml(employee?.position || "")}" required></label><label>Телефон<input name="phone" value="${escapeHtml(employee?.phone || "")}" placeholder="+7 ..."></label><label>Дата приёма<input name="hiredAt" type="date" value="${escapeHtml(employee?.hiredAt || todayKey)}" required></label><div class="form-actions"><button class="button modal-close" type="button">Отмена</button><button class="button primary" type="submit">Сохранить</button></div></form>`;
  openOverlay("modal");
  dom.modal.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", closeOverlay));
  dom.modal.querySelector("#employee-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api({ action: employee ? "updateEmployee" : "createEmployee", id: employee?.id, ...values, departmentId: Number(values.departmentId) }, employee ? "Данные сотрудника обновлены" : "Сотрудник добавлен");
    closeOverlay();
  });
}

function openEventModal() {
  dom.modal.innerHTML = `<div class="modal-head"><h2>Записать посещение</h2><button class="icon-button modal-close" type="button">×</button></div><form class="form-grid" id="event-form"><label class="wide">Сотрудник<select name="employeeId" required><option value="">Выберите сотрудника</option>${state.data.employees.map((employee) => `<option value="${employee.id}">${escapeHtml(employee.fullName)}</option>`).join("")}</select></label><label>Событие<select name="eventType"><option value="IN">Приход</option><option value="OUT">Уход</option></select></label><label>Дата и время<input name="eventTime" type="datetime-local" value="${new Date().toISOString().slice(0, 16)}" required></label><label class="wide">Комментарий<textarea name="comment" placeholder="Причина ручной корректировки"></textarea></label><div class="form-actions"><button class="button modal-close" type="button">Отмена</button><button class="button primary" type="submit">Записать</button></div></form>`;
  openOverlay("modal");
  dom.modal.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", closeOverlay));
  dom.modal.querySelector("#event-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api({ action: "addEvent", employeeId: Number(values.employeeId), eventType: values.eventType, eventTime: new Date(values.eventTime).toISOString(), comment: values.comment }, "Событие записано");
    closeOverlay();
  });
}

function openDepartmentModal() {
  dom.modal.innerHTML = `<div class="modal-head"><h2>Новый отдел</h2><button class="icon-button modal-close" type="button">×</button></div><form class="form-grid" id="department-form"><label class="wide">Название отдела<input name="name" required placeholder="Например, Юридический отдел"></label><div class="form-actions"><button class="button modal-close" type="button">Отмена</button><button class="button primary" type="submit">Создать</button></div></form>`;
  openOverlay("modal");
  dom.modal.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", closeOverlay));
  dom.modal.querySelector("#department-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api({ action: "createDepartment", name: values.name }, "Отдел создан");
    closeOverlay();
  });
}

async function quickEvent(employee, eventType) {
  await api({ action: "addEvent", employeeId: employee.id, eventType, eventTime: new Date().toISOString(), comment: "Отмечено администратором на сайте" }, eventType === "IN" ? "Приход отмечен" : "Уход отмечен");
  closeOverlay();
}

function openOverlay(type) {
  dom.backdrop.hidden = false;
  dom.drawer.hidden = type !== "drawer";
  dom.modal.hidden = type !== "modal";
  document.body.style.overflow = "hidden";
}

function closeOverlay() {
  dom.backdrop.hidden = true;
  dom.drawer.hidden = true;
  dom.modal.hidden = true;
  document.body.style.overflow = "";
}

function switchView(view) {
  state.view = titles[view] ? view : "dashboard";
  location.hash = state.view;
  dom.sidebar.classList.remove("open");
  render();
}

function shortDay(day) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

function drawHoursChart(count) {
  const days = lastDays(count);
  makeChart("hours-chart", "bar", days.map((day) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))), [{ label: "Рабочие часы", data: days.map((day) => Math.round(totalForDay(day) / 60)), backgroundColor: days.map((_, index) => index === days.length - 1 ? "#1970dd" : "#69a7ef"), borderRadius: 5 }]);
}

function averageEventMinutes(day, eventType) {
  const values = state.data.events.filter((event) => event.eventType === eventType && event.eventTime.slice(0, 10) === day).map((event) => {
    const [hour, minute] = event.eventTime.slice(11, 16).split(":").map(Number);
    return hour * 60 + minute;
  });
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function makeChart(id, type, labels, datasets, options = {}) {
  const canvas = document.querySelector(`#${id}`);
  if (!canvas || typeof Chart === "undefined") return;
  const chart = new Chart(canvas, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: options.timeAxis ? { label: (context) => `${context.dataset.label}: ${String(Math.floor(context.raw / 60)).padStart(2, "0")}:${String(context.raw % 60).padStart(2, "0")}` } : {} } },
      scales: { x: { grid: { display: false }, ticks: { color: "#718096", font: { size: 9 } } }, y: { beginAtZero: !options.timeAxis, min: options.timeAxis ? 420 : undefined, max: options.timeAxis ? 1200 : undefined, grid: { color: "#e9eef4" }, ticks: { color: "#718096", font: { size: 9 }, callback: options.timeAxis ? (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:00` : undefined } } },
    },
  });
  state.charts.push(chart);
}

function exportCsv(rows) {
  const cells = [["Сотрудник", "Отдел", "Период", "Часы"], ...rows.map((row) => [row.fullName, row.department, `${state.filters.from} - ${state.filters.to}`, Math.round(row.totalMinutes / 6) / 10])];
  const csv = cells.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `attendance-${state.filters.from}-${state.filters.to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function api(payload, successMessage) {
  try {
    const response = await fetch("/api/system", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (response.status === 401) {
      location.href = safeSignInPath(data.signInPath);
      return;
    }
    if (!response.ok) throw new Error(data.detail || data.error || "Не удалось сохранить данные");
    state.data = data;
    showToast(successMessage);
    render();
  } catch (error) {
    showToast(error.message || "Ошибка", true);
    throw error;
  }
}

function csrfToken() {
  const item = document.cookie.split("; ").find((cookie) => cookie.startsWith("attendance_csrf="));
  return item ? decodeURIComponent(item.split("=").slice(1).join("=")) : "";
}

async function updateUser(id, status, role) {
  try {
    const response = await fetch(`/api/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify({ status, role }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Не удалось обновить доступ");
    showToast(data.message);
    await renderUsers();
  } catch (error) { showToast(error.message || "Ошибка", true); }
}

async function logout() {
  const response = await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken() } });
  if (response.ok || response.status === 401) location.replace("/login");
  else showToast("Не удалось выйти", true);
}

function showToast(message, error = false) {
  dom.toast.textContent = message;
  dom.toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { dom.toast.className = "toast"; }, 3000);
}

async function load() {
  try {
    const response = await fetch("/api/system", { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await response.json();
    if (response.status === 401) {
      showSignInGate(data.signInPath);
      return;
    }
    if (!response.ok) throw new Error(data.detail || data.error || "Не удалось загрузить данные");
    state.data = data;
    const displayName = data.user?.name || "Администратор";
    document.querySelector("#account-name").textContent = displayName;
    document.querySelector("#account-avatar").textContent = initials(displayName);
    document.querySelector(".account small").textContent = roleLabel(data.user?.role);
    document.body.classList.add(`role-${data.user?.role || "viewer"}`);
    document.querySelectorAll(".admin-only").forEach((element) => { element.hidden = data.user?.role !== "admin"; });
    document.querySelector("#today-label").textContent = `▣  ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date())}`;
    render();
    await unlockApp();
  } catch (error) {
    dom.authMessage.textContent = error.message || "Не удалось проверить доступ";
    dom.authChecking.hidden = true;
    dom.authLogin.hidden = false;
    dom.authLogin.textContent = "Повторить проверку";
    dom.authLogin.dataset.path = "reload";
  }
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
document.querySelector("#mobile-menu").addEventListener("click", () => dom.sidebar.classList.toggle("open"));
document.querySelector("#sidebar-collapse").addEventListener("click", () => dom.sidebar.classList.toggle("compact"));
document.querySelector("#logout").addEventListener("click", logout);
dom.themeToggle.addEventListener("change", () => applyTheme(dom.themeToggle.checked ? "dark" : "light"));
dom.authLogin.addEventListener("click", () => {
  if (dom.authLogin.dataset.path === "reload") location.reload();
  else location.href = safeSignInPath(dom.authLogin.dataset.path);
});
dom.backdrop.addEventListener("click", closeOverlay);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeOverlay(); });
window.addEventListener("hashchange", () => { const view = location.hash.slice(1); if (titles[view] && view !== state.view) { state.view = view; render(); } });

applyTheme(document.documentElement.dataset.theme || "light", false);
load();
