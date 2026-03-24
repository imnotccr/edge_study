export function normalizeDomainInput(rawValue) {
  const value = rawValue.trim().toLowerCase();

  if (!value) {
    return null;
  }

  if (/[/?#]/.test(value) || value.includes("://") || value.includes(":")) {
    return null;
  }

  const normalized = value.replace(/^\.+/, "").replace(/\.+$/, "");
  const domainPattern = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  return domainPattern.test(normalized) ? normalized : null;
}

export function extractDomainFromUrl(url) {
  try {
    const parsed = new URL(url);

    if (!/^https?:$/.test(parsed.protocol)) {
      return null;
    }

    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function extractOriginFromUrl(url) {
  try {
    const parsed = new URL(url);

    if (!/^https?:$/.test(parsed.protocol)) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

export function matchesWhitelistHost(host, whitelistEntries) {
  const normalizedHost = host.toLowerCase();

  return whitelistEntries.some((entry) => {
    const domain = entry.domain.toLowerCase();

    if (entry.includeSubdomains) {
      return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
    }

    return normalizedHost === domain;
  });
}

export function isUrlAllowed(url, whitelistEntries) {
  const host = extractDomainFromUrl(url);

  if (!host) {
    return true;
  }

  return matchesWhitelistHost(host, whitelistEntries);
}
