import { Result } from "@/shared/core/utils/result"

export class DashboardHttpClient {
  public constructor(private readonly baseUrl: string) {}

  public async getJson<T>(path: string): Promise<Result<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`)
      if (!response.ok) {
        return Result.fail(new Error(`Request failed: ${response.status}`))
      }
      const data = (await response.json()) as T
      return Result.ok(data)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      return Result.fail(error)
    }
  }

  public async postJson(path: string, body?: unknown): Promise<Result<void>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) {
        return Result.fail(new Error(`Request failed: ${response.status}`))
      }
      return Result.ok(undefined)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      return Result.fail(error)
    }
  }
}
