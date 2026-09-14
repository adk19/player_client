import { Injectable } from '@angular/core';
import { BinanceSocketService } from './binance-socket.service';
import { TradingSocketService } from './trading-socket.service';
import { WatchlistSocketService } from './watchlist-socket.service';
import { MarketType } from '../shared/services/market.constants';

export interface SocketConnectionTest {
  serviceName: string;
  connected: boolean;
  latency?: number;
  error?: string;
}

export interface SocketHealthCheckResult {
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  services: SocketConnectionTest[];
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class SocketConnectionTestService {

  constructor(
    private binanceSocketService: BinanceSocketService,
    private tradingSocketService: TradingSocketService,
    private watchlistSocketService: WatchlistSocketService
  ) { }

  /**
   * Test all socket connections
   * @returns Promise with connection test results for all services
   */
  async testAllConnections(): Promise<SocketHealthCheckResult> {
    const results: SocketConnectionTest[] = [];
    const timestamp = Date.now();

    // Test Trading Socket
    try {
      const tradingConnected = await this.tradingSocketService.testConnection();
      results.push({
        serviceName: 'TradingSocket',
        connected: tradingConnected,
        latency: tradingConnected ? await this.measureLatency('trading') : undefined
      });
    } catch (error) {
      results.push({
        serviceName: 'TradingSocket',
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test Watchlist Socket
    try {
      const watchlistConnected = await this.watchlistSocketService.testConnection();
      results.push({
        serviceName: 'WatchlistSocket',
        connected: watchlistConnected,
        latency: watchlistConnected ? await this.measureLatency('watchlist') : undefined
      });
    } catch (error) {
      results.push({
        serviceName: 'WatchlistSocket',
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test Binance Socket (CRYPTO)
    try {
      const cryptoConnected = await this.binanceSocketService.testConnection(MarketType.CRYPTO);
      results.push({
        serviceName: 'BinanceSocket-CRYPTO',
        connected: cryptoConnected,
        latency: cryptoConnected ? await this.measureLatency('binance-crypto') : undefined
      });
    } catch (error) {
      results.push({
        serviceName: 'BinanceSocket-CRYPTO',
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test Binance Socket (INDEX)
    try {
      const indexConnected = await this.binanceSocketService.testConnection(MarketType.INDEX);
      results.push({
        serviceName: 'BinanceSocket-INDEX',
        connected: indexConnected,
        latency: indexConnected ? await this.measureLatency('binance-index') : undefined
      });
    } catch (error) {
      results.push({
        serviceName: 'BinanceSocket-INDEX',
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Calculate overall health
    const connectedCount = results.filter(r => r.connected).length;
    const totalCount = results.length;

    let overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    if (connectedCount === totalCount) {
      overallHealth = 'healthy';
    } else if (connectedCount >= totalCount / 2) {
      overallHealth = 'degraded';
    } else {
      overallHealth = 'unhealthy';
    }

    return {
      overallHealth,
      services: results,
      timestamp
    };
  }

  /**
   * Test connection for a specific service
   * @param serviceName Name of the service to test
   * @returns Promise with connection test result
   */
  async testConnection(serviceName: string): Promise<SocketConnectionTest> {
    const timestamp = Date.now();

    switch (serviceName) {
      case 'TradingSocket':
        try {
          const connected = await this.tradingSocketService.testConnection();
          return {
            serviceName,
            connected,
            latency: connected ? await this.measureLatency('trading') : undefined
          };
        } catch (error) {
          return {
            serviceName,
            connected: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }

      case 'WatchlistSocket':
        try {
          const connected = await this.watchlistSocketService.testConnection();
          return {
            serviceName,
            connected,
            latency: connected ? await this.measureLatency('watchlist') : undefined
          };
        } catch (error) {
          return {
            serviceName,
            connected: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }

      case 'BinanceSocket-CRYPTO':
        try {
          const connected = await this.binanceSocketService.testConnection(MarketType.CRYPTO);
          return {
            serviceName,
            connected,
            latency: connected ? await this.measureLatency('binance-crypto') : undefined
          };
        } catch (error) {
          return {
            serviceName,
            connected: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }

      case 'BinanceSocket-INDEX':
        try {
          const connected = await this.binanceSocketService.testConnection(MarketType.INDEX);
          return {
            serviceName,
            connected,
            latency: connected ? await this.measureLatency('binance-index') : undefined
          };
        } catch (error) {
          return {
            serviceName,
            connected: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }

      default:
        return {
          serviceName,
          connected: false,
          error: 'Unknown service'
        };
    }
  }

  /**
   * Get current connection status for all services
   * @returns Map of service names to their connection status
   */
  getConnectionStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>();

    status.set('TradingSocket', this.tradingSocketService.isConnected());
    status.set('WatchlistSocket', this.watchlistSocketService.isConnected());
    status.set('BinanceSocket-CRYPTO', this.binanceSocketService.isConnected(MarketType.CRYPTO));
    status.set('BinanceSocket-INDEX', this.binanceSocketService.isConnected(MarketType.INDEX));

    return status;
  }

  /**
   * Reconnect all sockets
   */
  reconnectAll(): void {
    // console.log('[SocketTest] Reconnecting all sockets...');
    this.tradingSocketService.reconnect();
    this.watchlistSocketService.reconnect();
    this.binanceSocketService.reconnect(MarketType.CRYPTO);
    this.binanceSocketService.reconnect(MarketType.INDEX);
  }

  /**
   * Reconnect a specific socket
   * @param serviceName Name of the service to reconnect
   */
  reconnect(serviceName: string): void {
    // console.log(`[SocketTest] Reconnecting ${serviceName}...`);
    switch (serviceName) {
      case 'TradingSocket':
        this.tradingSocketService.reconnect();
        break;
      case 'WatchlistSocket':
        this.watchlistSocketService.reconnect();
        break;
      case 'BinanceSocket-CRYPTO':
        this.binanceSocketService.reconnect(MarketType.CRYPTO);
        break;
      case 'BinanceSocket-INDEX':
        this.binanceSocketService.reconnect(MarketType.INDEX);
        break;
    }
  }

  /**
   * Measure latency for a specific service
   * @param service Name of the service to measure latency for
   * @returns Promise with latency in milliseconds
   */
  private async measureLatency(service: string): Promise<number> {
    const start = performance.now();

    switch (service) {
      case 'trading':
        await this.tradingSocketService.testConnection();
        break;
      case 'watchlist':
        await this.watchlistSocketService.testConnection();
        break;
      case 'binance-crypto':
        await this.binanceSocketService.testConnection(MarketType.CRYPTO);
        break;
      case 'binance-index':
        await this.binanceSocketService.testConnection(MarketType.INDEX);
        break;
    }

    return performance.now() - start;
  }

  /**
   * Start periodic health checks
   * @param intervalMs Interval in milliseconds between health checks
   * @returns Function to stop the periodic checks
   */
  startPeriodicHealthChecks(intervalMs: number = 30000): () => void {
    const interval = setInterval(() => {
      this.testAllConnections().then(result => {
        // console.log('[SocketTest] Health check result:', result);

        // Auto-reconnect if unhealthy
        if (result.overallHealth === 'unhealthy') {
          console.warn('[SocketTest] Unhealthy socket connections detected, reconnecting...');
          this.reconnectAll();
        }
      });
    }, intervalMs);

    return () => clearInterval(interval);
  }
}
