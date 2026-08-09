export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label="Sleepers Code splash screen"
      >
        <img alt="Sleepers Code" className="size-16 object-contain" src="/sleepers-mark.svg" />
      </div>
    </div>
  );
}
