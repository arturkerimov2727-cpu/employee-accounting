window.AttendanceTime = (() => {
  function validTimeZone(candidate) {
    const fallback = "Europe/Moscow";
    try {
      new Intl.DateTimeFormat("en", { timeZone: candidate || fallback }).format();
      return candidate || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function parts(value = new Date(), timeZone = "Europe/Moscow") {
    return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: validTimeZone(timeZone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  }

  function dateKey(value, timeZone) {
    const valueParts = parts(value, timeZone);
    return `${valueParts.year}-${valueParts.month}-${valueParts.day}`;
  }

  function browserDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function inputValue(value, timeZone) {
    const valueParts = parts(value, timeZone);
    return `${valueParts.year}-${valueParts.month}-${valueParts.day}T${valueParts.hour}:${valueParts.minute}`;
  }

  function inputToIso(value, timeZone) {
    const [datePart, timePart] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    let candidate = new Date(desired);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const valueParts = parts(candidate, timeZone);
      const represented = Date.UTC(
        Number(valueParts.year), Number(valueParts.month) - 1, Number(valueParts.day),
        Number(valueParts.hour), Number(valueParts.minute)
      );
      candidate = new Date(candidate.getTime() + desired - represented);
    }
    return candidate.toISOString();
  }

  function minutesOfDay(value, timeZone) {
    const valueParts = parts(value, timeZone);
    return Number(valueParts.hour) * 60 + Number(valueParts.minute);
  }

  return { browserDateKey, dateKey, inputToIso, inputValue, minutesOfDay, validTimeZone };
})();
