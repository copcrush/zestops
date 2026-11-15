import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

/** Structured JSON logger (one JSON object per line). Never pass secrets or tokens. */
function writeLog(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = JSON.stringify({ time: new Date().toISOString(), level, service: "web", msg: message, ...fields });
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => writeLog("debug", message, fields),
  info: (message: string, fields?: LogFields) => writeLog("info", message, fields),
  warn: (message: string, fields?: LogFields) => writeLog("warn", message, fields),
  error: (message: string, fields?: LogFields) => writeLog("error", message, fields),
};
