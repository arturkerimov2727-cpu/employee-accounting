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
  themeIcon: document.querySelector("#theme-icon")
};
const todayKey = new Date().toISOString().slice(0, 10);
const monthStart = `${todayKey.slice(0, 7)}-01`;
const state = {
  data: null,
  view: location.hash.slice(1) || "dashboard",
  charts: [],
  editingEmployee: null,
  filters: {
    query: "",
    employee: "",
    department: "",
    status: "",
    from: todayKey,
    to: todayKey
  }
};
const titles = {
  dashboard: "Check Workerss",
  employees: "Сотрудники",
  attendance: "Посещения",
  reports: "Отчёты",
  charts: "Графики",
  lateness: "Опоздания",
  departments: "Отделы",
  settings: "Настройки",
  audit: "Журнал событий",
  users: "Пользователи"
};
function applyTheme(theme, save = true) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  dom.themeToggle.checked = next === "dark";
  dom.themeIcon.textContent = next === "dark" ? "☀" : "☾";
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = next === "dark" ? "#0c1119" : "#ffffff";
  if (save) {
    try { localStorage.setItem("attendance-theme", next); } catch (_) {}
  }
  document.body.classList.add("theme-changing");
  clearTimeout(applyTheme.timer);
  applyTheme.timer = setTimeout(() => document.body.classList.remove("theme-changing"), 380);
  if (state.data) render();
}
function safeSignInPath(value) {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/login";
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
  setTimeout(() => dom.authGate.hidden = true, 420);
}
function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "С";
}
function formatDate(value, options = {}) {
  if (!value) return "-";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...options,
    timeZone: "UTC"
  }).format(date);
}
function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC"
  }).format(new Date(value));
}
function durationLabel(minutes) {
  if (minutes === null || Number.isNaN(minutes)) return "-";
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)} ч ${String(safe % 60).padStart(2, "0")} мин`;
}
function minutesBetween(start, end) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60000);
}
function employeeSessions(employeeId, from = "0000-01-01", to = "9999-12-31") {
  const events = state.data.events
    .filter((event) => Number(event.employeeId) === Number(employeeId))
    .filter((event) => {
      const day = event.eventTime.slice(0, 10);
      return day >= from && day <= to;
    })
    .sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  const days = new Map();
  events.forEach((event) => {
    const day = event.eventTime.slice(0, 10);
    if (!days.has(day)) {
      days.set(day, {
        date: day,
        in: null,
        out: null,
        minutes: null
      });
    }
    const row = days.get(day);
    if (event.eventType === "IN" && !row.in) row.in = event.eventTime;
    if (event.eventType === "OUT" && row.in) row.out = event.eventTime;
  });
  return [...days.values()]
    .map((row) => ({
      ...row,
      minutes: row.in && row.out ? minutesBetween(row.in, row.out) : null,
      status: row.in && !row.out ? "На работе" : row.out ? "Ушёл" : "Нет данных"
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
function todayRecord(employeeId) {
  return employeeSessions(employeeId, todayKey, todayKey)[0] || {
    date: todayKey,
    in: null,
    out: null,
    minutes: null,
    status: "Нет данных"
  };
}
function workingMinutes(row) {
  if (row.minutes !== null) return row.minutes;
  if (row.in && !row.out && row.date === todayKey) {
    return minutesBetween(row.in, new Date().toISOString());
  }
  return 0;
}
function allTodayRows() {
  return state.data.employees.map((employee) => ({
    ...employee,
    record: todayRecord(employee.id)
  }));
}
function filteredRows() {
  const filters = state.filters;
  return state.data.employees
    .map((employee) => {
      const sessions = employeeSessions(employee.id, filters.from, filters.to);
      const record = sessions[0] || {
        in: null,
        out: null,
        minutes: null,
        status: "Нет данных"
      };
      return {
        ...employee,
        record,
        sessions,
        totalMinutes: sessions.reduce((sum, row) => sum + workingMinutes(row), 0)
      };
    })
    .filter((row) => {
      const text = `${row.fullName} ${row.department} ${row.position}`.toLowerCase();
      return (!filters.query || text.includes(filters.query.toLowerCase())) &&
        (!filters.employee || String(row.id) === String(filters.employee)) &&
        (!filters.department || String(row.departmentId) === String(filters.department)) &&
        (!filters.status || row.record.status === filters.status);
    });
}
function setStatus(element, status) {
  element.textContent = status;
  element.classList.remove("working", "left", "absent");
  if (status === "На работе" || status === "Активен") {
    element.classList.add("working");
  } else if (status === "Ушёл" || status === "Ожидает") {
    element.classList.add("left");
  } else {
    element.classList.add("absent");
  }
}
function fillSelect(select, items, selected, emptyLabel = "Все") {
  select.replaceChildren();
  if (emptyLabel !== null) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
  }
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    option.selected = String(item.value) === String(selected);
    select.append(option);
  });
}
function syncFilterSet(name) {
  const root = document.querySelector(`[data-filter-set="${name}"]`);
  if (!root) return;
  fillSelect(
    root.querySelector('[data-filter="employee"]'),
    state.data.employees.map((employee) => ({
      value: employee.id,
      label: employee.fullName
    })),
    state.filters.employee
  );
  fillSelect(
    root.querySelector('[data-filter="department"]'),
    state.data.departments.map((department) => ({
      value: department.id,
      label: department.name
    })),
    state.filters.department
  );
  root.querySelector('[data-filter="query"]').value = state.filters.query;
  root.querySelector('[data-filter="status"]').value = state.filters.status;
  root.querySelector('[data-filter="from"]').value = state.filters.from;
  root.querySelector('[data-filter="to"]').value = state.filters.to;
}
function readFilters(root) {
  state.filters = {
    query: root.querySelector('[data-filter="query"]').value.trim(),
    employee: root.querySelector('[data-filter="employee"]').value,
    department: root.querySelector('[data-filter="department"]').value,
    status: root.querySelector('[data-filter="status"]').value,
    from: root.querySelector('[data-filter="from"]').value || todayKey,
    to: root.querySelector('[data-filter="to"]').value || todayKey
  };
}
function renderEmployeeTable(name, rows, period = false) {
  const block = document.querySelector(`[data-table="${name}"]`);
  const body = block.querySelector("tbody");
  const empty = block.querySelector("[data-empty]");
  const template = document.querySelector("#employee-row-template");
  body.replaceChildren();
  rows.forEach((row) => {
    const fragment = template.content.cloneNode(true);
    const tr = fragment.querySelector("tr");
    tr.dataset.employeeId = row.id;
    fragment.querySelector("[data-avatar]").textContent = initials(row.fullName);
    fragment.querySelector("[data-name]").textContent = row.fullName;
    fragment.querySelector("[data-position]").textContent = row.position;
    fragment.querySelector("[data-department]").textContent = row.department;
    fragment.querySelector("[data-in]").textContent = formatTime(row.record.in);
    fragment.querySelector("[data-out]").textContent = formatTime(row.record.out);
    fragment.querySelector("[data-duration]").textContent = period
      ? durationLabel(row.totalMinutes)
      : durationLabel(row.record.minutes);
    setStatus(fragment.querySelector("[data-status]"), row.record.status);
    body.append(fragment);
  });
  empty.hidden = rows.length > 0;
  block.querySelector(".table-wrap").hidden = rows.length === 0;
  block.querySelector("[data-shown]").textContent = rows.length;
  block.querySelector("[data-total]").textContent = state.data.employees.length;
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
  document.querySelector("#metric-working").textContent = working.length;
  document.querySelector("#metric-arrived").textContent = arrived.length;
  document.querySelector("#metric-left").textContent = left.length;
  document.querySelector("#metric-hours").textContent = `${Math.round(totalMinutes / 60)} ч`;
  const dashboard = state.data.dashboard || {};
  document.querySelector("#metric-late").textContent = dashboard.lateToday || 0;
  document.querySelector("#metric-absent").textContent = dashboard.absent || 0;
  document.querySelector("#metric-open-shifts").textContent = dashboard.openShifts || 0;
  document.querySelector("#metric-employees").textContent = dashboard.totalEmployees || state.data.employees.length;
  document.querySelector("#working-count").textContent = working.length;
  const list = document.querySelector("#working-list");
  const empty = document.querySelector("#working-empty");
  const template = document.querySelector("#working-row-template");
  list.replaceChildren();
  working.slice(0, 6).forEach((row) => {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector("button");
    button.dataset.employeeId = row.id;
    fragment.querySelector("[data-avatar]").textContent = initials(row.fullName);
    fragment.querySelector("[data-name]").textContent = row.fullName;
    fragment.querySelector("[data-department]").textContent = row.department;
    fragment.querySelector("[data-time]").textContent = formatTime(row.record.in);
    list.append(fragment);
  });
  empty.hidden = working.length > 0;
  syncFilterSet("dashboard");
  renderEmployeeTable("dashboard", filteredRows());
  const days = lastDays(Number(document.querySelector("#chart-period").value || 7));
  const chart = AttendanceCharts.drawHoursChart("hours-chart", days, days.map((day) => totalForDay(day) / 60));
  if (chart) state.charts.push(chart);
}
function renderEmployees() {
  const query = state.filters.query.toLowerCase();
  const rows = state.data.employees
    .filter((employee) =>
      `${employee.fullName} ${employee.department} ${employee.position}`
        .toLowerCase()
        .includes(query)
    )
    .map((employee) => ({
      ...employee,
      record: todayRecord(employee.id)
    }));
  document.querySelector("#employee-search").value = state.filters.query;
  renderEmployeeTable("employees", rows);
}
function renderAttendance() {
  const events = state.data.events.slice(0, 300);
  const arrived = new Set(
    state.data.events
      .filter((event) => event.eventType === "IN" && event.eventTime.slice(0, 10) === todayKey)
      .map((event) => event.employeeId)
  ).size;
  const totalEmployees = state.data.employees.length;
  const notArrived = Math.max(0, totalEmployees - arrived);
  document.querySelector("#attendance-total-employees").textContent = totalEmployees;
  document.querySelector("#attendance-arrived").textContent = arrived;
  document.querySelector("#attendance-not-arrived").textContent = notArrived;
  const chart = AttendanceCharts.drawAttendanceSummary(
    "attendance-summary-chart", totalEmployees, arrived, notArrived
  );
  if (chart) state.charts.push(chart);
  const body = document.querySelector("#attendance-body");
  const template = document.querySelector("#attendance-row-template");
  body.replaceChildren();
  events.forEach((event) => {
    const fragment = template.content.cloneNode(true);
    const tr = fragment.querySelector("tr");
    tr.dataset.employeeId = event.employeeId;
    fragment.querySelector("[data-time]").textContent =
      `${formatDate(event.eventTime)} ${formatTime(event.eventTime)}`;
    fragment.querySelector("[data-avatar]").textContent = initials(event.employeeName);
    fragment.querySelector("[data-name]").textContent = event.employeeName;
    fragment.querySelector("[data-department]").textContent = event.department;
    const badge = fragment.querySelector("[data-event]");
    badge.textContent = event.eventType === "IN" ? "⇥ Приход" : "⇤ Уход";
    badge.classList.add(event.eventType === "IN" ? "working" : "left");
    fragment.querySelector("[data-source]").textContent = event.source;
    fragment.querySelector("[data-actor]").textContent = event.createdByName || event.createdBy || "-";
    fragment.querySelector("[data-actor-email]").textContent = event.createdByEmail || "-";
    fragment.querySelector("[data-comment]").textContent = event.comment || "-";
    body.append(fragment);
  });
  document.querySelector("#attendance-empty").hidden = events.length > 0;
  document.querySelector("#attendance-count").textContent = Math.min(events.length, 300);
}
function renderReports() {
  if (state.filters.from === todayKey) state.filters.from = monthStart;
  syncFilterSet("reports");
  const rows = filteredRows();
  const totalMinutes = rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  const shifts = rows.reduce(
    (sum, row) => sum + row.sessions.filter((session) => session.out).length,
    0
  );
  const average = shifts ? totalMinutes / shifts : 0;
  document.querySelector("#report-total-hours").textContent = durationLabel(totalMinutes);
  document.querySelector("#report-shifts").textContent = shifts;
  document.querySelector("#report-average").textContent = durationLabel(average);
  document.querySelector("#report-period").textContent =
    `${formatDate(state.filters.from)} по ${formatDate(state.filters.to)}`;
  renderEmployeeTable("reports", rows, true);
}
function renderCharts() {
  const days = lastDays(14);
  const charts = AttendanceCharts.drawAttendanceCharts(
    "monthly-chart", "time-chart", days, days.map((day) => totalForDay(day) / 60), state.data.events
  );
  state.charts.push(...charts);
}
function renderDepartments() {
  const grid = document.querySelector("#department-grid");
  const empty = document.querySelector("#departments-empty");
  const template = document.querySelector("#department-card-template");
  grid.replaceChildren();
  state.data.departments.forEach((department) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector("[data-name]").textContent = department.name;
    fragment.querySelector("[data-count]").textContent = department.employeeCount;
    fragment.querySelector("[data-delete-department]").dataset.departmentId = department.id;
    fragment.querySelector("[data-delete-department]").hidden = state.data.user.role !== "admin";
    grid.append(fragment);
  });
  empty.hidden = state.data.departments.length > 0;
}
function renderSettings() {
  const settings = state.data.settings;
  const form = document.querySelector("#settings-form");
  form.elements.organization.value = settings.organization || "";
  form.elements.workday_start.value = settings.workday_start || "09:00";
  form.elements.workday_end.value = settings.workday_end || "18:00";
  form.elements.timezone.value = settings.timezone || "Europe/Moscow";
  const profile = document.querySelector("#admin-profile-form");
  profile.elements.full_name.value = state.data.user.name || "";
  profile.elements.email.value = state.data.user.email || "";
  profile.closest(".panel").hidden = state.data.user.role !== "admin";
}
function renderAudit() {
  const list = document.querySelector("#audit-list");
  const empty = document.querySelector("#audit-empty");
  const template = document.querySelector("#audit-item-template");
  list.replaceChildren();
  state.data.audit.forEach((item) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector("[data-date]").textContent = formatDate(item.createdAt);
    fragment.querySelector("[data-time]").textContent = formatTime(item.createdAt);
    fragment.querySelector("[data-details]").textContent = item.details || item.action;
    fragment.querySelector("[data-entity]").textContent =
      `${item.entityType}${item.entityId ? ` #${item.entityId}` : ""}`;
    fragment.querySelector("[data-actor]").textContent = item.actor;
    const approve = fragment.querySelector("[data-approve]");
    const canApprove = state.data.user?.role === "admin"
      && state.data.notifications?.pendingUserIds?.includes(item.entityId);
    if (item.action === "REGISTER" && item.entityId && canApprove) {
      approve.hidden = false;
      approve.dataset.userId = item.entityId;
    }
    list.append(fragment);
  });
  empty.hidden = state.data.audit.length > 0;
}
function renderNotifications() {
  const badge = document.querySelector("#notification-count");
  const pending = state.data.user?.role === "admin"
    ? state.data.notifications?.pendingUserIds?.length || 0
    : 0;
  badge.hidden = pending === 0;
  badge.textContent = pending > 99 ? "99+" : pending;
}
function roleLabel(role) {
  return {
    admin: "Администратор",
    manager: "Руководитель",
    viewer: "Наблюдатель"
  }[role] || role;
}
function userStatusLabel(status) {
  return {
    pending: "Ожидает",
    active: "Активен",
    disabled: "Отключён"
  }[status] || status;
}
async function renderUsers() {
  const forbidden = document.querySelector("#users-forbidden");
  const loading = document.querySelector("#users-loading");
  const errorBox = document.querySelector("#users-error");
  const content = document.querySelector("#users-content");
  forbidden.hidden = true;
  loading.hidden = true;
  errorBox.hidden = true;
  content.hidden = true;
  if (state.data.user?.role !== "admin") {
    forbidden.hidden = false;
    return;
  }
  loading.hidden = false;
  try {
    const response = await fetch("/api/users", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.detail || "Не удалось загрузить пользователей");
    }
    loading.hidden = true;
    content.hidden = false;
    const body = document.querySelector("#users-body");
    const empty = document.querySelector("#users-empty");
    const template = document.querySelector("#user-row-template");
    body.replaceChildren();
    data.users.forEach((item) => {
      const fragment = template.content.cloneNode(true);
      const row = fragment.querySelector("tr");
      const role = fragment.querySelector("[data-role]");
      const status = fragment.querySelector("[data-status]");
      const save = fragment.querySelector("[data-save]");
      const approve = fragment.querySelector("[data-approve]");
      const disable = fragment.querySelector("[data-disable]");
      row.dataset.userId = item.id;
      fragment.querySelector("[data-avatar]").textContent = initials(item.fullName);
      fragment.querySelector("[data-name]").textContent = item.fullName;
      fragment.querySelector("[data-email]").textContent = item.email;
      fragment.querySelector("[data-created]").textContent = formatDate(item.createdAt);
      role.value = item.role;
      role.dataset.userId = item.id;
      setStatus(status, userStatusLabel(item.status));
      save.dataset.userId = item.id;
      save.dataset.status = "active";
      approve.dataset.userId = item.id;
      approve.dataset.status = "active";
      disable.dataset.userId = item.id;
      disable.dataset.status = "disabled";
      save.hidden = item.status !== "active";
      approve.hidden = item.status === "active";
      disable.hidden = item.status === "disabled";
      body.append(fragment);
    });
    empty.hidden = data.users.length > 0;
    document.querySelector("#users-total").textContent = data.users.length;
    document.querySelector("#users-pending").textContent =
      data.users.filter((item) => item.status === "pending").length;
  } catch (error) {
    loading.hidden = true;
    errorBox.hidden = false;
    errorBox.querySelector("p").textContent =
      error.message || "Не удалось загрузить пользователей";
  }
}
function render() {
  if (!state.data) return;
  state.charts.forEach((chart) => chart.destroy());
  state.charts = [];
  if (!titles[state.view]) state.view = "dashboard";
  dom.pageTitle.textContent = titles[state.view];
  document.querySelectorAll(".app-view").forEach((view) => {
    view.hidden = view.dataset.page !== state.view;
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  const renderer = {
    dashboard: renderDashboard,
    employees: renderEmployees,
    attendance: renderAttendance,
    reports: renderReports,
    charts: renderCharts,
    lateness: renderLateness,
    departments: renderDepartments,
    settings: renderSettings,
    audit: renderAudit,
    users: renderUsers
  }[state.view];
  renderNotifications();
  renderer();
  dom.content.focus();
}
function showEmployee(id) {
  const employee = state.data.employees.find((item) => Number(item.id) === Number(id));
  if (!employee) return;
  const today = todayRecord(id);
  const month = employeeSessions(id, monthStart, todayKey);
  const monthMinutes = month.reduce((sum, row) => sum + workingMinutes(row), 0);
  dom.drawer.dataset.employeeId = employee.id;
  document.querySelector("#drawer-avatar").textContent = initials(employee.fullName);
  document.querySelector("#drawer-name").textContent = employee.fullName;
  document.querySelector("#drawer-position").textContent =
    `${employee.position} · ${employee.department}`;
  setStatus(document.querySelector("#drawer-status"), today.status);
  document.querySelector("#drawer-in").textContent = formatTime(today.in);
  document.querySelector("#drawer-out").textContent = formatTime(today.out);
  document.querySelector("#drawer-today").textContent = durationLabel(workingMinutes(today));
  document.querySelector("#drawer-month").textContent = durationLabel(monthMinutes);
  document.querySelector("#drawer-phone").textContent = employee.phone || "-";
  document.querySelector("#drawer-hired").textContent = formatDate(employee.hiredAt);
  document.querySelector("#drawer-email").textContent = employee.email || "-";
  document.querySelector("#drawer-birthday").textContent = formatDate(employee.birthDate);
  const shifts = document.querySelector("#drawer-shifts");
  const empty = document.querySelector("#drawer-shifts-empty");
  const template = document.querySelector("#shift-row-template");
  shifts.replaceChildren();
  month.slice(0, 6).forEach((row) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector("[data-date]").textContent = formatDate(row.date);
    fragment.querySelector("[data-time]").textContent =
      `${formatTime(row.in)} → ${formatTime(row.out)}`;
    shifts.append(fragment);
  });
  empty.hidden = month.length > 0;
  const quick = document.querySelector("#quick-event");
  const atWork = today.status === "На работе";
  quick.textContent = atWork ? "⇤ Отметить уход" : "⇥ Отметить приход";
  quick.className = `button ${atWork ? "orange" : "success"}`;
  quick.dataset.eventType = atWork ? "OUT" : "IN";
  openOverlay("drawer");
  loadEmployeeInsights(id);
}
function openEmployeeModal(employee = null) {
  closeOverlay();
  state.editingEmployee = employee;
  const panel = showModalPanel("employee");
  const form = panel.querySelector("#employee-form");
  document.querySelector("#employee-modal-title").textContent =
    employee ? "Изменить сотрудника" : "Новый сотрудник";
  form.reset();
  fillSelect(
    form.elements.departmentId,
    state.data.departments.map((department) => ({
      value: department.id,
      label: department.name
    })),
    employee?.departmentId || "",
    "Выберите отдел"
  );
  form.elements.fullName.value = employee?.fullName || "";
  form.elements.position.value = employee?.position || "";
  form.elements.phone.value = employee?.phone || "";
  form.elements.email.value = employee?.email || "";
  form.elements.birthDate.value = employee?.birthDate || "";
  form.elements.telegramId.value = employee?.telegramId || "";
  form.elements.hiredAt.value = employee?.hiredAt || todayKey;
  openOverlay("modal");
}
function openEventModal() {
  closeOverlay();
  const panel = showModalPanel("event");
  const form = panel.querySelector("#event-form");
  form.reset();
  fillSelect(
    form.elements.employeeId,
    state.data.employees.map((employee) => ({
      value: employee.id,
      label: employee.fullName
    })),
    "",
    "Выберите сотрудника"
  );
  form.elements.eventType.value = "IN";
  form.elements.eventTime.value = new Date().toISOString().slice(0, 16);
  openOverlay("modal");
}
function openDepartmentModal() {
  closeOverlay();
  const panel = showModalPanel("department");
  panel.querySelector("#department-form").reset();
  openOverlay("modal");
}
function showModalPanel(name) {
  let selected = null;
  dom.modal.querySelectorAll(".modal-panel").forEach((panel) => {
    panel.hidden = panel.dataset.modal !== name;
    if (panel.dataset.modal === name) selected = panel;
  });
  return selected;
}
async function quickEvent(employee, eventType) {
  await api({
    action: "addEvent",
    employeeId: employee.id,
    eventType,
    eventTime: new Date().toISOString(),
    comment: "Отмечено администратором на сайте"
  }, eventType === "IN" ? "Приход отмечен" : "Уход отмечен");
  closeOverlay();
}
function openOverlay(type) {
  dom.backdrop.hidden = false;
  dom.drawer.hidden = type !== "drawer";
  dom.modal.hidden = type !== "modal";
  document.body.classList.add("overlay-open");
}
function closeOverlay() {
  dom.backdrop.hidden = true;
  dom.drawer.hidden = true;
  dom.modal.hidden = true;
  document.body.classList.remove("overlay-open");
}
function switchView(view) {
  state.view = titles[view] ? view : "dashboard";
  location.hash = state.view;
  dom.sidebar.classList.remove("open");
  render();
}
function exportCsv(rows) {
  const cells = [
    ["Сотрудник", "Отдел", "Период", "Часы"],
    ...rows.map((row) => [
      row.fullName,
      row.department,
      `${state.filters.from} - ${state.filters.to}`,
      Math.round(row.totalMinutes / 6) / 10
    ])
  ];
  const csv = cells
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")
    )
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob(["\ufeff", csv], {
      type: "text/csv;charset=utf-8"
    })
  );
  link.download = `attendance-${state.filters.from}-${state.filters.to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
async function api(payload, successMessage) {
  try {
    const response = await fetch("/api/system", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken()
      },
      body: JSON.stringify(payload)
    });
    const data = await readJson(response);
    if (response.status === 401) {
      location.href = safeSignInPath(data.signInPath);
      return;
    }
    if (!response.ok) {
      throw new Error(data.detail || data.error || "Не удалось сохранить данные");
    }
    state.data = data;
    showToast(successMessage);
    render();
  } catch (error) {
    showToast(error.message || "Ошибка", true);
    throw error;
  }
}
async function readJson(response) {
  if ((response.headers.get("content-type") || "").includes("application/json")) return response.json().catch(() => ({}));
  const text = await response.text().catch(() => "");
  return { detail: response.status >= 500 ? "Ошибка сервера. Повторите попытку позже." : text.trim() || "Сервер вернул пустой ответ" };
}
async function loadEmployeeInsights(employeeId, period = "month") {
  try {
    const [summaryResponse, calendarResponse, scheduleResponse] = await Promise.all([
      fetch(`/api/attendance/employees/${employeeId}/summary?period=${period}`),
      fetch(`/api/attendance/employees/${employeeId}/calendar`),
      fetch(`/api/attendance/employees/${employeeId}/schedule`)
    ]);
    const [summary, calendar, schedule] = await Promise.all([readJson(summaryResponse), readJson(calendarResponse), readJson(scheduleResponse)]);
    if (!summaryResponse.ok || !calendarResponse.ok || !scheduleResponse.ok) throw new Error(summary.detail || calendar.detail || "Не удалось загрузить статистику");
    const stats = summary.statistics;
    const cells = [["Смен", stats.shifts], ["Время", durationLabel(stats.workedMinutes)], ["Опоздания", `${stats.lateCount} / ${stats.lateMinutes} мин`], ["Ранние уходы", `${stats.earlyLeaveCount} / ${stats.earlyLeaveMinutes} мин`], ["Переработка", durationLabel(stats.overtimeMinutes)], ["Отсутствия", stats.approvedAbsences]];
    document.querySelector("#employee-stats").innerHTML = cells.map(([name, value]) => `<div class="detail-cell"><small>${name}</small><strong>${value}</strong></div>`).join("");
    document.querySelector("#employee-calendar").innerHTML = calendar.days.map((day) => `<button class="calendar-day ${day.state}${day.lateMinutes ? " late" : ""}${day.earlyLeaveMinutes ? " early" : ""}" title="${day.date}: ${day.absenceLabel || day.state}" type="button">${Number(day.date.slice(-2))}</button>`).join("");
    const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    document.querySelector("#employee-schedule").innerHTML = schedule.schedule.map((row) => `<div class="schedule-row-preview"><span>${names[row.weekday]}</span><b>${row.isWorkday ? `${row.startsAt}–${row.endsAt}` : "Выходной"}</b></div>`).join("");
  } catch (error) {
    document.querySelector("#employee-stats").textContent = error.message || "Нет данных";
  }
}
async function renderLateness() {
  const from = document.querySelector("#lateness-from");
  const to = document.querySelector("#lateness-to");
  from.value ||= monthStart;
  to.value ||= todayKey;
  const response = await fetch(`/api/attendance/analytics/lateness?from=${from.value}&to=${to.value}`);
  const data = await readJson(response);
  if (!response.ok) { showToast(data.detail || "Не удалось загрузить аналитику", true); return; }
  const body = document.querySelector("#lateness-body");
  body.innerHTML = data.rows.map((row) => `<tr><td>${row.fullName}</td><td>${row.department}</td><td>${row.lateCount}</td><td>${durationLabel(row.lateMinutes)}</td><td>${durationLabel(row.averageLateMinutes)}</td><td>${durationLabel(row.overtimeMinutes)}</td></tr>`).join("");
  document.querySelector("#lateness-empty").hidden = data.rows.length > 0;
}
function exportServerReport(format) {
  const params = new URLSearchParams({ from: state.filters.from, to: state.filters.to });
  if (state.filters.employee) params.set("employee_id", state.filters.employee);
  if (state.filters.department) params.set("department_id", state.filters.department);
  window.location.assign(`/api/attendance/export/${format}?${params}`);
}
function csrfToken() {
  const item = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("attendance_csrf="));
  if (!item) return "";
  return decodeURIComponent(item.split("=").slice(1).join("="));
}
async function updateUser(id, status, role) {
  try {
    const response = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken()
      },
      body: JSON.stringify({ status, role })
    });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.detail || "Не удалось обновить доступ");
    }
    showToast(data.message);
    if (state.view === "users") await renderUsers();
  } catch (error) {
    showToast(error.message || "Ошибка", true);
  }
}
async function approveFromAudit(button) {
  const userId = Number(button.dataset.userId);
  button.disabled = true;
  button.textContent = "Одобряем...";
  try {
    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken()
      },
      body: JSON.stringify({
        status: "active",
        role: "viewer"
      })
    });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.detail || "Не удалось одобрить пользователя");
    }
    state.data.notifications.pendingUserIds = state.data.notifications.pendingUserIds
      .filter((id) => Number(id) !== userId);
    button.hidden = true;
    renderNotifications();
    showToast("Пользователь одобрен");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Одобрить";
    showToast(error.message || "Ошибка", true);
  }
}
async function logout() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: {
      "X-CSRF-Token": csrfToken()
    }
  });
  if (response.ok || response.status === 401) {
    location.replace("/login");
    return;
  }
  showToast("Не удалось выйти", true);
}
function showToast(message, error = false) {
  dom.toast.textContent = message;
  dom.toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    dom.toast.className = "toast";
  }, 3000);
}
async function load() {
  try {
    const response = await fetch("/api/system", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    const data = await readJson(response);
    if (response.status === 401) {
      showSignInGate(data.signInPath);
      return;
    }
    if (!response.ok) {
      throw new Error(data.detail || data.error || "Не удалось загрузить данные");
    }
    state.data = data;
    const displayName = data.user?.name || "Администратор";
    document.querySelector("#account-name").textContent = displayName;
    document.querySelector("#account-avatar").textContent = initials(displayName);
    document.querySelector("#account-role").textContent = roleLabel(data.user?.role);
    document.body.classList.remove("role-admin", "role-manager", "role-viewer");
    document.body.classList.add(`role-${data.user?.role || "viewer"}`);
    document.querySelectorAll(".admin-only").forEach((element) => {
      element.hidden = data.user?.role !== "admin";
    });
    document.querySelector("#today-label").textContent =
      `▣  ${new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric"
      }).format(new Date())}`;
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
document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});
document.querySelector("#mobile-menu").addEventListener("click", () => {
  dom.sidebar.classList.toggle("open");
});
document.querySelector("#sidebar-collapse").addEventListener("click", () => {
  dom.sidebar.classList.toggle("compact");
});
document.querySelector("#logout").addEventListener("click", logout);
document.querySelector("#notifications").addEventListener("click", () => {
  switchView("audit");
});
dom.themeToggle.addEventListener("change", () => {
  applyTheme(dom.themeToggle.checked ? "dark" : "light");
});
dom.authLogin.addEventListener("click", () => {
  if (dom.authLogin.dataset.path === "reload") {
    location.reload();
    return;
  }
  location.href = safeSignInPath(dom.authLogin.dataset.path);
});
dom.backdrop.addEventListener("click", closeOverlay);
document.querySelector("#drawer-close").addEventListener("click", closeOverlay);
document.querySelectorAll(".modal-close").forEach((button) => {
  button.addEventListener("click", closeOverlay);
});
document.querySelector("#add-employee").addEventListener("click", () => {
  openEmployeeModal();
});
document.querySelector("#add-event").addEventListener("click", openEventModal);
document.querySelector("#add-department").addEventListener("click", openDepartmentModal);
document.querySelector("#chart-period").addEventListener("change", (event) => {
  if (state.view !== "dashboard") return;
  state.charts.forEach((chart) => chart.destroy());
  state.charts = [];
  state.charts.forEach((chart) => chart.destroy());
  state.charts = [];
  const days = lastDays(Number(event.target.value));
  const chart = AttendanceCharts.drawHoursChart("hours-chart", days, days.map((day) => totalForDay(day) / 60));
  if (chart) state.charts.push(chart);
});
document.querySelector("#employee-search").addEventListener("input", (event) => {
  state.filters.query = event.target.value;
  renderEmployees();
});
document.querySelectorAll("[data-action='apply-filters']").forEach((button) => {
  button.addEventListener("click", () => {
    readFilters(button.closest(".filter-set"));
    render();
  });
});
document.querySelectorAll("[data-action='reset-filters']").forEach((button) => {
  button.addEventListener("click", () => {
    state.filters = {
      query: "",
      employee: "",
      department: "",
      status: "",
      from: todayKey,
      to: todayKey
    };
    render();
  });
});
document.querySelectorAll('[data-filter="query"]').forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    readFilters(input.closest(".filter-set"));
    render();
  });
});
document.querySelector("[data-go='attendance']").addEventListener("click", () => {
  switchView("attendance");
});
document.querySelector("#export-csv").addEventListener("click", () => {
  exportServerReport("csv");
});
document.querySelector("#export-xlsx").addEventListener("click", () => exportServerReport("xlsx"));
document.querySelector("#export-pdf").addEventListener("click", () => exportServerReport("pdf"));
document.querySelector("#load-lateness").addEventListener("click", renderLateness);
document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await api({
    action: "updateSettings",
    settings: values
  }, "Настройки сохранены");
});
document.querySelector("#admin-profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  if (!values.new_password) delete values.new_password;
  try {
    const response = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify(values)
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.detail || "Не удалось обновить профиль");
    state.data.user.name = data.user.name;
    state.data.user.email = data.user.email;
    document.querySelector("#account-name").textContent = data.user.name;
    document.querySelector("#account-avatar").textContent = initials(data.user.name);
    event.currentTarget.elements.current_password.value = "";
    event.currentTarget.elements.new_password.value = "";
    render();
    showToast(data.message);
  } catch (error) {
    showToast(error.message || "Ошибка", true);
  }
});
document.querySelector("#employee-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const employee = state.editingEmployee;
  if (!values.telegramId) delete values.telegramId;
  else values.telegramId = Number(values.telegramId);
  if (!values.email) delete values.email;
  if (!values.birthDate) delete values.birthDate;
  await api({
    action: employee ? "updateEmployee" : "createEmployee",
    id: employee?.id,
    ...values,
    departmentId: Number(values.departmentId)
  }, employee ? "Данные сотрудника обновлены" : "Сотрудник добавлен");
  closeOverlay();
});
document.querySelector("#event-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await api({
    action: "addEvent",
    employeeId: Number(values.employeeId),
    eventType: values.eventType,
    eventTime: new Date(values.eventTime).toISOString(),
    comment: values.comment
  }, "Событие записано");
  closeOverlay();
});
document.querySelector("#department-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await api({
    action: "createDepartment",
    name: values.name
  }, "Отдел создан");
  closeOverlay();
});
document.querySelector("#edit-employee").addEventListener("click", () => {
  const id = Number(dom.drawer.dataset.employeeId);
  const employee = state.data.employees.find((item) => Number(item.id) === id);
  if (employee) openEmployeeModal(employee);
});
document.querySelector("#employee-period").addEventListener("click", (event) => {
  const button = event.target.closest("[data-period]");
  if (!button || !dom.drawer.dataset.employeeId) return;
  document.querySelectorAll("#employee-period [data-period]").forEach((item) => item.classList.toggle("active", item === button));
  loadEmployeeInsights(Number(dom.drawer.dataset.employeeId), button.dataset.period);
});
document.querySelector("#edit-schedule").addEventListener("click", async () => {
  const employeeId = Number(dom.drawer.dataset.employeeId);
  if (!employeeId) return;
  const response = await fetch(`/api/attendance/employees/${employeeId}/schedule`);
  const data = await readJson(response);
  if (!response.ok) return showToast(data.detail || "Не удалось загрузить график", true);
  const names = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
  document.querySelector("#schedule-fields").innerHTML = data.schedule.map((row) => `<label class="schedule-editor-row"><span>${names[row.weekday]}</span><input type="checkbox" data-workday ${row.isWorkday ? "checked" : ""}><input type="time" data-start value="${row.startsAt || "09:00"}"><input type="time" data-end value="${row.endsAt || "18:00"}></label>`).join("");
  showModalPanel("schedule"); openOverlay("modal");
});
document.querySelector("#schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const employeeId = Number(dom.drawer.dataset.employeeId);
  const schedule = [...document.querySelectorAll("#schedule-fields .schedule-editor-row")].map((row, weekday) => ({ weekday, isWorkday: row.querySelector("[data-workday]").checked, startsAt: row.querySelector("[data-start]").value, endsAt: row.querySelector("[data-end]").value }));
  const response = await fetch(`/api/attendance/employees/${employeeId}/schedule`, { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() }, body: JSON.stringify({ schedule }) });
  const data = await readJson(response);
  if (!response.ok) return showToast(data.detail || "Не удалось сохранить график", true);
  closeOverlay(); showToast("График сохранён"); loadEmployeeInsights(employeeId);
});
document.querySelector("#add-absence").addEventListener("click", () => {
  document.querySelector("#absence-form").reset();
  document.querySelector("#absence-form").elements.startsOn.value = todayKey;
  document.querySelector("#absence-form").elements.endsOn.value = todayKey;
  showModalPanel("absence"); openOverlay("modal");
});
document.querySelector("#absence-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.employeeId = Number(dom.drawer.dataset.employeeId);
  const response = await fetch("/api/attendance/absences", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() }, body: JSON.stringify(values) });
  const data = await readJson(response);
  if (!response.ok) return showToast(data.detail || "Не удалось сохранить отсутствие", true);
  closeOverlay(); showToast(data.message); loadEmployeeInsights(values.employeeId);
});
document.querySelector("#quick-event").addEventListener("click", async (event) => {
  const id = Number(dom.drawer.dataset.employeeId);
  const employee = state.data.employees.find((item) => Number(item.id) === id);
  if (employee) {
    await quickEvent(employee, event.currentTarget.dataset.eventType);
  }
});
document.querySelector("#archive-employee").addEventListener("click", async () => {
  const id = Number(dom.drawer.dataset.employeeId);
  const employee = state.data.employees.find((item) => Number(item.id) === id);
  if (!employee) return;
  if (!confirm(`Удалить сотрудника «${employee.fullName}» из активного списка? История посещений сохранится.`)) return;
  await api({
    action: "archiveEmployee",
    id: employee.id
  }, "Сотрудник удалён из активного списка");
  closeOverlay();
});
dom.content.addEventListener("click", async (event) => {
  const departmentButton = event.target.closest("[data-delete-department]");
  if (departmentButton) {
    const department = state.data.departments.find((item) => Number(item.id) === Number(departmentButton.dataset.departmentId));
    if (!department || !confirm(`Удалить отдел «${department.name}»?`)) return;
    await api({ action: "deleteDepartment", id: department.id }, "Отдел удалён");
    return;
  }
  const auditButton = event.target.closest(".audit-approve");
  if (auditButton) {
    await approveFromAudit(auditButton);
    return;
  }
  const userButton = event.target.closest(".user-update");
  if (userButton) {
    const id = Number(userButton.dataset.userId);
    const row = userButton.closest("tr");
    const role = row.querySelector("[data-role]").value;
    await updateUser(id, userButton.dataset.status, role);
    return;
  }
  const employee = event.target.closest("[data-employee-id]");
  if (employee) {
    showEmployee(Number(employee.dataset.employeeId));
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOverlay();
});
window.addEventListener("hashchange", () => {
  const view = location.hash.slice(1);
  if (titles[view] && view !== state.view) {
    state.view = view;
    render();
  }
});
let initialTheme = "light";
try {
  initialTheme = localStorage.getItem("attendance-theme") || "light";
} catch (_) {}
applyTheme(initialTheme, false);
load();
