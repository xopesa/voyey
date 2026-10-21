"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getUserOrders, ApiRequestError } from "../../lib/api-client";
import { readAccessToken } from "../../lib/auth-storage";
import { OrdersFeed } from "../../lib/orders-feed";
import { filterOrders, type OrdersFilter } from "../../lib/orders";
import { useTelegramSession } from "../TelegramSession";
import { usePreferences } from "../PreferencesProvider";
import { Button, Card, Page } from "../ui/foundation";
import { ChoiceGroup } from "../ui/ChoiceGroup";
import { OrderListCard, OrdersFailure, OrdersLoading } from "./OrderParts";
import { useOrdersRefresh } from "./useOrdersRefresh";
function ActiveOrders() {
  const { t } = usePreferences();
  const [filter, setFilter] = useState<OrdersFilter>("all");
  const [feed] = useState(
    () =>
      new OrdersFeed((cursor, signal) => {
        const token = readAccessToken();
        if (!token) throw new ApiRequestError(401);
        return getUserOrders(token, cursor, signal);
      }),
  );
  const state = useSyncExternalStore(
    feed.subscribe,
    feed.snapshot,
    feed.snapshot,
  );
  const refresh = useCallback(() => void feed.start(), [feed]);
  useEffect(() => {
    refresh();
    return feed.cancel;
  }, [feed, refresh]);
  useOrdersRefresh(refresh);
  if (state.loading) return <OrdersLoading />;
  const visible = filterOrders(state.orders, filter),
    hasMore = state.nextCursor !== null;
  return (
    <Page className="orders-page">
      <header className="orders-heading">
        <p className="ui-eyebrow">{t("orders.eyebrow")}</p>
        <h1>{t("nav.orders")}</h1>
        <p className="ui-copy">{t("orders.subtitle")}</p>
        <Button
          variant="secondary"
          disabled={state.refreshing}
          onClick={refresh}
          aria-busy={state.refreshing}
        >
          {t(state.refreshing ? "orders.refreshing" : "orders.refresh")}
        </Button>
      </header>
      {state.error && <OrdersFailure error={state.error} retry={refresh} />}
      {state.error !== "auth" && (
        <>
          <ChoiceGroup
            label={t("orders.filters")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("orders.all") },
              { value: "active", label: t("orders.active") },
              { value: "completed", label: t("orders.completed") },
            ]}
          />
          {filter !== "all" && (
            <p className="orders-filter-hint">
              {t(
                filter === "completed"
                  ? "orders.completedHint"
                  : "orders.filterHint",
              )}
            </p>
          )}
          {visible.length > 0 ? (
            <div className="orders-list">
              {visible.map((order) => (
                <OrderListCard key={order.publicId} order={order} />
              ))}
            </div>
          ) : (
            !state.error && (
              <Card className="cart-state">
                <h2>
                  {t(
                    state.orders.length === 0 && !hasMore
                      ? "orders.empty"
                      : "orders.filterEmpty",
                  )}
                </h2>
                <p>
                  {t(
                    state.orders.length === 0 && !hasMore
                      ? "orders.emptyHint"
                      : hasMore
                        ? "orders.filterMoreHint"
                        : "orders.filterEmptyHint",
                  )}
                </p>
                {state.orders.length === 0 && !hasMore && (
                  <Link
                    className="ui-button ui-button--primary"
                    href="/catalog"
                  >
                    {t("cart.toCatalog")}
                  </Link>
                )}
              </Card>
            )
          )}
          {state.moreError && (
            <OrdersFailure
              error={state.moreError}
              retry={() => void feed.more()}
            />
          )}
          {hasMore && (
            <Button
              variant="secondary"
              disabled={
                state.refreshing ||
                state.loadingMore ||
                !!state.error ||
                state.moreError === "auth"
              }
              aria-busy={state.loadingMore}
              onClick={() => void feed.more()}
            >
              {t(
                state.loadingMore ? "catalog.loadingMore" : "catalog.loadMore",
              )}
            </Button>
          )}
          {state.orders.length > 0 && (
            <p className="orders-filter-hint">
              {t("orders.loaded", { count: state.orders.length })}
            </p>
          )}
        </>
      )}
    </Page>
  );
}
export function OrdersPageContent() {
  const { status } = useTelegramSession();
  if (status === "loading") return <OrdersLoading />;
  if (status !== "authenticated")
    return (
      <Page className="orders-page">
        <OrdersFailure error="auth" retry={() => window.location.reload()} />
      </Page>
    );
  return <ActiveOrders />;
}
