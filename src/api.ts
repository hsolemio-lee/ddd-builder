import type { Card, Project } from './types';

export class ApiError extends Error {
  status: number;
  current?: Card | Project;
  constructor(message: string, status: number, current?: Card | Project) {
    super(message);
    this.status = status;
    this.current = current;
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      value.error || '요청을 처리하지 못했어요.',
      response.status,
      value.current,
    );
  return value as T;
}
