import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './app/shared/environment/environment';

async function loadConfigAndBootstrap() {

  try {
    const response = await fetch('configuration/configuration.json');

    if (response.ok) {
      const json: any = await response.json();
      const env = json?.environment;

      if (env) {
        environment.APIUrl = env.api_url || environment.APIUrl;
        environment.BrandCode = env.brand_code || environment.BrandCode;
        environment.CryptoApiUrl = env.crypto_api_url || environment.CryptoApiUrl;
        environment.CryptoWebSocketUrl = env.crypto_websocket_url || environment.CryptoWebSocketUrl;
        environment.Mt5SocketUrl = env.mt5_websocket_url || environment.Mt5SocketUrl;
        environment.TradingSocketUrl = env.trading_socket_url || environment.TradingSocketUrl;
        environment.SocketUrl = env.socket_url || environment.SocketUrl;
      }
    }
  } catch (err) {
    console.error('Error loading configuration.json', err);
  }
  bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
}

loadConfigAndBootstrap();