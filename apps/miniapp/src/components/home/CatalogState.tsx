"use client";

import { usePreferences } from "../PreferencesProvider";
import { Button, Card } from "../ui/foundation";
import { Icon } from "../ui/Icon";

export function CatalogState({
  kind,
  error = false,
  retry,
}: {
  kind: "categories" | "products";
  error?: boolean;
  retry?: () => void;
}) {
  const { t } = usePreferences();
  return (
    <Card className="home-state" role={error ? "alert" : "status"}>
      <Icon name={error ? "retry" : "catalog"} />
      <p className="home-state__title">
        {t(error ? `home.${kind}Error` : `home.${kind}Empty`)}
      </p>
      <p className="ui-copy">
        {t(error ? "home.errorHint" : `home.${kind}EmptyHint`)}
      </p>
      {error && retry && (
        <Button variant="secondary" onClick={retry}>
          {t("home.retry")}
        </Button>
      )}
    </Card>
  );
}
