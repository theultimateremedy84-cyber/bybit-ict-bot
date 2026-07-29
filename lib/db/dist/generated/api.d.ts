import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AccountInfo, BotSettings, BotStatus, ClosePositionResponse, ErrorResponse, GetSignalsParams, GetTradesParams, HealthStatus, MarketData, Performance, Position, Signal, Trade, UpdateSettingsRequest } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetBotStatusUrl: () => string;
/**
 * @summary Get bot status
 */
export declare const getBotStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<BotStatus>;
export declare const getGetBotStatusQueryKey: () => readonly ["/api/bot/status"];
export declare const getGetBotStatusQueryOptions: <TData = Awaited<ReturnType<typeof getBotStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBotStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBotStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBotStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getBotStatus>>>;
export type GetBotStatusQueryError = ErrorType<unknown>;
/**
 * @summary Get bot status
 */
export declare function useGetBotStatus<TData = Awaited<ReturnType<typeof getBotStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBotStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getStartBotUrl: () => string;
/**
 * @summary Start the trading bot
 */
export declare const startBot: (options?: Parameters<typeof customFetch>[1]) => Promise<BotStatus>;
export declare const getStartBotMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startBot>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof startBot>>, TError, void, TContext>;
export type StartBotMutationResult = NonNullable<Awaited<ReturnType<typeof startBot>>>;
export type StartBotMutationError = ErrorType<ErrorResponse>;
/**
* @summary Start the trading bot
*/
export declare const useStartBot: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startBot>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof startBot>>, TError, void, TContext>;
export declare const getStopBotUrl: () => string;
/**
 * @summary Stop the trading bot
 */
export declare const stopBot: (options?: Parameters<typeof customFetch>[1]) => Promise<BotStatus>;
export declare const getStopBotMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof stopBot>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof stopBot>>, TError, void, TContext>;
export type StopBotMutationResult = NonNullable<Awaited<ReturnType<typeof stopBot>>>;
export type StopBotMutationError = ErrorType<ErrorResponse>;
/**
* @summary Stop the trading bot
*/
export declare const useStopBot: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof stopBot>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof stopBot>>, TError, void, TContext>;
export declare const getGetAccountUrl: () => string;
/**
 * @summary Get account balance and info
 */
export declare const getAccount: (options?: Parameters<typeof customFetch>[1]) => Promise<AccountInfo>;
export declare const getGetAccountQueryKey: () => readonly ["/api/account"];
export declare const getGetAccountQueryOptions: <TData = Awaited<ReturnType<typeof getAccount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAccount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAccount>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAccountQueryResult = NonNullable<Awaited<ReturnType<typeof getAccount>>>;
export type GetAccountQueryError = ErrorType<unknown>;
/**
 * @summary Get account balance and info
 */
export declare function useGetAccount<TData = Awaited<ReturnType<typeof getAccount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAccount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetMarketsUrl: () => string;
/**
 * @summary Get market data for enabled symbols
 */
export declare const getMarkets: (options?: Parameters<typeof customFetch>[1]) => Promise<MarketData[]>;
export declare const getGetMarketsQueryKey: () => readonly ["/api/markets"];
export declare const getGetMarketsQueryOptions: <TData = Awaited<ReturnType<typeof getMarkets>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMarkets>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMarkets>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMarketsQueryResult = NonNullable<Awaited<ReturnType<typeof getMarkets>>>;
export type GetMarketsQueryError = ErrorType<unknown>;
/**
 * @summary Get market data for enabled symbols
 */
export declare function useGetMarkets<TData = Awaited<ReturnType<typeof getMarkets>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMarkets>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPositionsUrl: () => string;
/**
 * @summary Get open positions
 */
export declare const getPositions: (options?: Parameters<typeof customFetch>[1]) => Promise<Position[]>;
export declare const getGetPositionsQueryKey: () => readonly ["/api/positions"];
export declare const getGetPositionsQueryOptions: <TData = Awaited<ReturnType<typeof getPositions>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPositions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPositions>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPositionsQueryResult = NonNullable<Awaited<ReturnType<typeof getPositions>>>;
export type GetPositionsQueryError = ErrorType<unknown>;
/**
 * @summary Get open positions
 */
export declare function useGetPositions<TData = Awaited<ReturnType<typeof getPositions>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPositions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getClosePositionUrl: (symbol: string) => string;
/**
 * @summary Close an open position
 */
export declare const closePosition: (symbol: string, options?: Parameters<typeof customFetch>[1]) => Promise<ClosePositionResponse>;
export declare const getClosePositionMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof closePosition>>, TError, {
        symbol: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof closePosition>>, TError, {
    symbol: string;
}, TContext>;
export type ClosePositionMutationResult = NonNullable<Awaited<ReturnType<typeof closePosition>>>;
export type ClosePositionMutationError = ErrorType<ErrorResponse>;
/**
* @summary Close an open position
*/
export declare const useClosePosition: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof closePosition>>, TError, {
        symbol: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof closePosition>>, TError, {
    symbol: string;
}, TContext>;
export declare const getGetSignalsUrl: (params?: GetSignalsParams) => string;
/**
 * @summary Get recent ICT signals
 */
export declare const getSignals: (params?: GetSignalsParams, options?: Parameters<typeof customFetch>[1]) => Promise<Signal[]>;
export declare const getGetSignalsQueryKey: (params?: GetSignalsParams) => readonly ["/api/signals", ...GetSignalsParams[]];
export declare const getGetSignalsQueryOptions: <TData = Awaited<ReturnType<typeof getSignals>>, TError = ErrorType<unknown>>(params?: GetSignalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSignals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSignals>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSignalsQueryResult = NonNullable<Awaited<ReturnType<typeof getSignals>>>;
export type GetSignalsQueryError = ErrorType<unknown>;
/**
 * @summary Get recent ICT signals
 */
export declare function useGetSignals<TData = Awaited<ReturnType<typeof getSignals>>, TError = ErrorType<unknown>>(params?: GetSignalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSignals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetSignalByIdUrl: (id: number) => string;
/**
 * @summary Get a signal by ID
 */
export declare const getSignalById: (id: number, options?: Parameters<typeof customFetch>[1]) => Promise<Signal>;
export declare const getGetSignalByIdQueryKey: (id: number) => readonly [`/api/signals/${number}`];
export declare const getGetSignalByIdQueryOptions: <TData = Awaited<ReturnType<typeof getSignalById>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSignalById>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSignalById>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSignalByIdQueryResult = NonNullable<Awaited<ReturnType<typeof getSignalById>>>;
export type GetSignalByIdQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get a signal by ID
 */
export declare function useGetSignalById<TData = Awaited<ReturnType<typeof getSignalById>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSignalById>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetTradesUrl: (params?: GetTradesParams) => string;
/**
 * @summary Get trade history
 */
export declare const getTrades: (params?: GetTradesParams, options?: Parameters<typeof customFetch>[1]) => Promise<Trade[]>;
export declare const getGetTradesQueryKey: (params?: GetTradesParams) => readonly ["/api/trades", ...GetTradesParams[]];
export declare const getGetTradesQueryOptions: <TData = Awaited<ReturnType<typeof getTrades>>, TError = ErrorType<unknown>>(params?: GetTradesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrades>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTrades>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTradesQueryResult = NonNullable<Awaited<ReturnType<typeof getTrades>>>;
export type GetTradesQueryError = ErrorType<unknown>;
/**
 * @summary Get trade history
 */
export declare function useGetTrades<TData = Awaited<ReturnType<typeof getTrades>>, TError = ErrorType<unknown>>(params?: GetTradesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrades>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPerformanceUrl: () => string;
/**
 * @summary Get performance statistics
 */
export declare const getPerformance: (options?: Parameters<typeof customFetch>[1]) => Promise<Performance>;
export declare const getGetPerformanceQueryKey: () => readonly ["/api/performance"];
export declare const getGetPerformanceQueryOptions: <TData = Awaited<ReturnType<typeof getPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPerformance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPerformanceQueryResult = NonNullable<Awaited<ReturnType<typeof getPerformance>>>;
export type GetPerformanceQueryError = ErrorType<unknown>;
/**
 * @summary Get performance statistics
 */
export declare function useGetPerformance<TData = Awaited<ReturnType<typeof getPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetSettingsUrl: () => string;
/**
 * @summary Get bot settings
 */
export declare const getSettings: (options?: Parameters<typeof customFetch>[1]) => Promise<BotSettings>;
export declare const getGetSettingsQueryKey: () => readonly ["/api/settings"];
export declare const getGetSettingsQueryOptions: <TData = Awaited<ReturnType<typeof getSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSettings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSettingsQueryResult = NonNullable<Awaited<ReturnType<typeof getSettings>>>;
export type GetSettingsQueryError = ErrorType<unknown>;
/**
 * @summary Get bot settings
 */
export declare function useGetSettings<TData = Awaited<ReturnType<typeof getSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateSettingsUrl: () => string;
/**
 * @summary Update bot settings
 */
export declare const updateSettings: (updateSettingsRequest: UpdateSettingsRequest, options?: Parameters<typeof customFetch>[1]) => Promise<BotSettings>;
export declare const getUpdateSettingsMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSettings>>, TError, {
        data: BodyType<UpdateSettingsRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateSettings>>, TError, {
    data: BodyType<UpdateSettingsRequest>;
}, TContext>;
export type UpdateSettingsMutationResult = NonNullable<Awaited<ReturnType<typeof updateSettings>>>;
export type UpdateSettingsMutationBody = BodyType<UpdateSettingsRequest>;
export type UpdateSettingsMutationError = ErrorType<ErrorResponse>;
/**
* @summary Update bot settings
*/
export declare const useUpdateSettings: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSettings>>, TError, {
        data: BodyType<UpdateSettingsRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateSettings>>, TError, {
    data: BodyType<UpdateSettingsRequest>;
}, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map