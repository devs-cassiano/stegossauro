export function getDevCsp(): string {
  return "default-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; img-src 'self' blob: data:; object-src 'none'; worker-src 'self' blob:;";
}

export function getProdCsp(): string {
  return "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; worker-src 'self' blob:; child-src 'self' blob:; form-action 'none'; base-uri 'none';";
}

export function getCspPolicy(isDev = false): string {
  return isDev ? getDevCsp() : getProdCsp();
}
