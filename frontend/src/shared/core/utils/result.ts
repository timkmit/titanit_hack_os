type SuccessResultData<T> = {
  isSuccess: true
  value: T
}

type ErrorResultData<E extends Error> = {
  isSuccess: false
  error: E
}

export class Result<TData, TError extends Error = Error> {
  private constructor(
    private readonly data: SuccessResultData<TData> | ErrorResultData<TError>,
  ) {}

  public get isSuccess(): boolean {
    return this.data.isSuccess
  }

  public get isFailure(): boolean {
    return !this.data.isSuccess
  }

  public get value(): TData {
    if (!this.data.isSuccess) {
      throw new Error("Cannot read value from failed result")
    }
    return this.data.value
  }

  public get error(): TError {
    if (this.data.isSuccess) {
      throw new Error("Cannot read error from success result")
    }
    return this.data.error
  }

  public static ok<TData, TError extends Error = Error>(
    value: TData,
  ): Result<TData, TError> {
    return new Result<TData, TError>({ isSuccess: true, value })
  }

  public static fail<TData = never, TError extends Error = Error>(
    error: TError,
  ): Result<TData, TError> {
    return new Result<TData, TError>({ isSuccess: false, error })
  }

  public match<R>(handlers: {
    success: (value: TData) => R
    failure: (error: TError) => R
  }): R {
    if (this.data.isSuccess) {
      return handlers.success(this.data.value)
    }
    return handlers.failure(this.data.error)
  }
}
