export function Brand() {
  return (
    <div className="brand" aria-label="STENZO Wear">
      <svg
        className="brand__mark"
        width="34"
        height="30"
        viewBox="0 0 36 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          className="brand__accent"
          d="M9 1h12a5 5 0 0 1 3.5 1.5L35 13v18L9 1Z"
        />
        <path
          d="M2 10v16a5 5 0 0 0 5 5h10L2 10Zm4 0h9l19 21H24L6 10Z"
          fill="currentColor"
        />
      </svg>
      <span className="brand__type" aria-hidden="true">
        <span className="brand__name">STENZO</span>
        <span className="brand__wear">WEAR</span>
      </span>
    </div>
  );
}
