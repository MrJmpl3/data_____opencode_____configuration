export function truncate(value: string, max: number): string {
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function stripPrivateTags(value: string): string {
  if (!value) {
    return '';
  }

  return value.replace(/<private>[\s\S]*?<\/private>/gi, '[REDACTED]').trim();
}
