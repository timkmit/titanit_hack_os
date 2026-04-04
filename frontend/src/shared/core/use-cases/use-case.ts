import type { Result } from "@/shared/core/utils/result"

export abstract class UseCase<TCommand, TResult> {
  public abstract execute(command: TCommand): Promise<Result<TResult>>
}
