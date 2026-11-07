/** Service error carrying the HTTP status the route should answer with. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}
