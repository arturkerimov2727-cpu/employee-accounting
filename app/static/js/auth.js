const page = document.body.dataset.page;
const form = document.querySelector("#auth-form");
const alertBox = document.querySelector("#form-alert");

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  document.querySelector(".auth-theme").textContent = next === "dark" ? "☀" : "☾";
  try { localStorage.setItem("attendance-theme", next); } catch (_) {}
}

function showAlert(message, success = false) {
  alertBox.textContent = message;
  alertBox.className = `form-alert${success ? " success" : ""}`;
  alertBox.hidden = false;
}

async function send(payload) {
  const endpoint = page === "register" ? "/api/auth/register" : "/api/auth/login";
  const response = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || "Не удалось выполнить запрос");
  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  alertBox.hidden = true;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  if (page === "register" && values.password !== values.password_confirm) {
    showAlert("Пароли не совпадают"); return;
  }
  const button = form.querySelector(".submit-button");
  const original = button.querySelector("span").textContent;
  button.disabled = true;
  button.querySelector("span").textContent = "Проверяем...";
  try {
    const data = await send(values);
    if (page === "login") {
      location.replace("/");
    } else {
      showAlert(data.message, true);
      form.reset();
      setTimeout(() => location.replace("/login"), data.firstAdmin ? 900 : 2200);
    }
  } catch (error) {
    showAlert(error.message || "Ошибка");
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = original;
  }
});

document.querySelectorAll(".show-password").forEach((button) => button.addEventListener("click", () => {
  const input = button.parentElement.querySelector("input");
  input.type = input.type === "password" ? "text" : "password";
  button.textContent = input.type === "password" ? "◉" : "×";
}));

document.querySelector(".auth-theme").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
let initialTheme = "light";
try { initialTheme = localStorage.getItem("attendance-theme") || "light"; } catch (_) {}
applyTheme(initialTheme);

fetch("/api/auth/me", { cache: "no-store" }).then((response) => {
  if (response.ok && page === "login") location.replace("/");
}).catch(() => {});
