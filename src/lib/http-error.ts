export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    public readonly flags?: Record<string, boolean>,
  ) {
    super(message);
  }

  static notFound(entity: string) {
    return new HttpError(404, `${entity} não encontrado`);
  }
}
