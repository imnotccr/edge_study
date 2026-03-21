import { AppError, ERROR_CODES } from "./errors.js";

export async function sendRuntimeMessage(type, payload = {}) {
  let response;

  try {
    response = await chrome.runtime.sendMessage({ type, payload });
  } catch (error) {
    throw new AppError(ERROR_CODES.TRANSPORT_FAILED, "扩展通信失败，请重新加载扩展后再试。", {
      cause: error?.message ?? null
    });
  }

  if (!response?.ok) {
    throw new AppError(
      response?.code ?? ERROR_CODES.TRANSPORT_FAILED,
      response?.error ?? "扩展通信失败，请重新加载扩展后再试。",
      response?.details ?? null
    );
  }

  return response.data;
}

export async function openExtensionPage(path) {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}
