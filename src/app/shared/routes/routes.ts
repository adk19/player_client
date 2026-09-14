import { Routes } from "@angular/router";
import { HomeComponent } from "../../components/pages/home/home.component";
import { TradeComponent } from "../../components/trade/trade.component";
import { TradeRoutes } from "../../components/trade/trade.routes";
import { AccountComponent } from "../../components/account/account.component";
import { AccountRoutes } from "../../components/account/account-routing.module";
import { AuthGuard } from "../guards/auth.guard";
import { PreLoginGuard } from "../guards/pre-login.guard";
import { WatchlistComponent } from "../../components/trade/crypto/watchlist/watchlist.component";
import { PositionsComponent } from "../../components/trade/crypto/positions/positions.component";
import { DesktopTradeRedirectGuard } from "../guards/desktop-trade-redirect.guard";

export const routing: Routes = [
    // {
    //     path: 'home',
    //     component: HomeComponent,
    //     canActivate: [AuthGuard]
    // },
    {
        path: 'trade',
        component: TradeComponent,
        canActivate: [AuthGuard],
        children: TradeRoutes
    },
    {
        path: 'account',
        component: AccountComponent,
        canActivate: [AuthGuard],
        children: AccountRoutes
    },
    {
        path: 'watchlist',
        component: WatchlistComponent,
        canActivate: [AuthGuard, DesktopTradeRedirectGuard]
    },
    {
        path: 'orders',
        component: PositionsComponent,
        canActivate: [AuthGuard, DesktopTradeRedirectGuard]
    },
]