import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

function classes(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export function Page({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("ui-page", className)} {...props} />;
}

type SectionProps = HTMLAttributes<HTMLElement> & { title?: string };
export function Section({
  title,
  children,
  className,
  ...props
}: SectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={classes("ui-section", className)}
      {...props}
    >
      {title && (
        <h2 id={headingId} className="ui-section__title">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("ui-card", className)} {...props} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};
export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes(`ui-button ui-button--${variant}`, className)}
      {...props}
    />
  );
}

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & { label: string; children: ReactNode };
export function IconButton({
  label,
  children,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={classes("ui-icon-button", className)}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent";
};
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={classes(`ui-badge ui-badge--${tone}`, className)}
      {...props}
    />
  );
}

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={classes("ui-skeleton", className)}
      {...props}
    />
  );
}

export function Divider({
  className,
  ...props
}: HTMLAttributes<HTMLHRElement>) {
  return <hr className={classes("ui-divider", className)} {...props} />;
}
