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
  dashboard: "Система учёта сотрудников",
  employees: "Сотрудники",
  attendance: "Посещения",
  reports: "Отчёты",
  charts: "Графики",
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
  drawHoursChart(Number(document.querySelector("#chart-period").value || 7));
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

  makeChart("monthly-chart", "bar", days.map(shortDay), [{
    label: "Часы",
    data: days.map((day) => Math.round((totalForDay(day) / 60) * 10) / 10),
    backgroundColor: cssVar("--chart-blue"),
    borderRadius: 5
  }]);

  makeChart("time-chart", "line", days.map(shortDay), [
    {
      label: "Приход",
      data: days.map((day) => averageEventMinutes(day, "IN")),
      borderColor: cssVar("--chart-green"),
      backgroundColor: cssVar("--chart-green-soft"),
      tension: 0.35
    },
    {
      label: "Уход",
      data: days.map((day) => averageEventMinutes(day, "OUT")),
      borderColor: cssVar("--chart-orange"),
      backgroundColor: cssVar("--chart-orange-soft"),
      tension: 0.35
    }
  ], { timeAxis: true });
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

    if (item.action === "REGISTER" && item.entityId) {
      approve.hidden = false;
      approve.dataset.userId = item.entityId;
    }

    list.append(fragment);
  });

  empty.hidden = state.data.audit.length > 0;
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

    const data = await response.json();

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
    departments: renderDepartments,
    settings: renderSettings,
    audit: renderAudit,
    users: renderUsers
  }[state.view];

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


function shortDay(day) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${day}T12:00:00Z`));
}


function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}


function drawHoursChart(count) {
  const days = lastDays(count);

  makeChart(
    "hours-chart",
    "bar",
    days.map((day) =>
      new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        weekday: "short",
        timeZone: "UTC"
      }).format(new Date(`${day}T12:00:00Z`))
    ),
    [{
      label: "Рабочие часы",
      data: days.map((day) => Math.round(totalForDay(day) / 60)),
      backgroundColor: days.map((_, index) =>
        index === days.length - 1
          ? cssVar("--chart-blue")
          : cssVar("--chart-blue-soft")
      ),
      borderRadius: 5
    }]
  );
}


function averageEventMinutes(day, eventType) {
  const values = state.data.events
    .filter((event) =>
      event.eventType === eventType &&
      event.eventTime.slice(0, 10) === day
    )
    .map((event) => {
      const [hour, minute] = event.eventTime.slice(11, 16).split(":").map(Number);
      return hour * 60 + minute;
    });

  if (!values.length) return null;

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}


function makeChart(id, type, labels, datasets, options = {}) {
  const canvas = document.querySelector(`#${id}`);

  if (!canvas || typeof Chart === "undefined") return;

  const chart = new Chart(canvas, {
    type,

    data: {
      labels,
      datasets
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,

      interaction: {
        intersect: false,
        mode: "index"
      },

      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: {
            boxWidth: 10,
            font: { size: 10 }
          }
        },

        tooltip: {
          callbacks: options.timeAxis ? {
            label: (context) =>
              `${context.dataset.label}: ` +
              `${String(Math.floor(context.raw / 60)).padStart(2, "0")}:` +
              `${String(context.raw % 60).padStart(2, "0")}`
          } : {}
        }
      },

      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: cssVar("--chart-text"),
            font: { size: 9 }
          }
        },

        y: {
          beginAtZero: !options.timeAxis,
          min: options.timeAxis ? 420 : undefined,
          max: options.timeAxis ? 1200 : undefined,
          grid: { color: cssVar("--chart-grid") },

          ticks: {
            color: cssVar("--chart-text"),
            font: { size: 9 },

            callback: options.timeAxis
              ? (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:00`
              : undefined
          }
        }
      }
    }
  });

  state.charts.push(chart);
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

    const data = await response.json();

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

    const data = await response.json();

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

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Не удалось одобрить пользователя");
    }

    button.textContent = "Одобрено";
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

    const data = await response.json();

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

  drawHoursChart(Number(event.target.value));
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
  exportCsv(filteredRows());
});


document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const values = Object.fromEntries(new FormData(event.currentTarget));

  await api({
    action: "updateSettings",
    settings: values
  }, "Настройки сохранены");
});


document.querySelector("#employee-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const values = Object.fromEntries(new FormData(event.currentTarget));
  const employee = state.editingEmployee;

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
  if (!confirm(`Переместить сотрудника «${employee.fullName}» в архив?`)) return;

  await api({
    action: "archiveEmployee",
    id: employee.id
  }, "Сотрудник перемещён в архив");

  closeOverlay();
});


dom.content.addEventListener("click", async (event) => {
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