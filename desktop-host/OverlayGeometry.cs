namespace Nolane.DesktopHost;

internal readonly record struct NativePixelRect(int Left, int Top, int Right, int Bottom)
{
    public int Width => Right - Left;
    public int Height => Bottom - Top;
}

internal static class OverlayGeometry
{
    private const double MinimumScale = 0.75;
    private const double MaximumScale = 4.0;
    private const double MinimumCssExtent = 2.0;

    public static bool TryCreateSurfaceRect(
        double x,
        double y,
        double clipX,
        double clipY,
        double clipWidth,
        double clipHeight,
        double scale,
        int viewportWidth,
        int viewportHeight,
        out NativePixelRect rect)
    {
        rect = default;
        if (!IsViewportUsable(scale, viewportWidth, viewportHeight) ||
            !double.IsFinite(x) || !double.IsFinite(y) ||
            !double.IsFinite(clipX) || !double.IsFinite(clipY) ||
            !double.IsFinite(clipWidth) || !double.IsFinite(clipHeight) ||
            clipX < 0 || clipY < 0 || clipWidth < MinimumCssExtent || clipHeight < MinimumCssExtent)
            return false;

        var left = ClampPixel(Math.Floor((x + clipX) * scale), viewportWidth);
        var top = ClampPixel(Math.Floor((y + clipY) * scale), viewportHeight);
        var right = ClampPixel(Math.Ceiling((x + clipX + clipWidth) * scale), viewportWidth);
        var bottom = ClampPixel(Math.Ceiling((y + clipY + clipHeight) * scale), viewportHeight);

        if (right - left < 2 || bottom - top < 2) return false;
        rect = new NativePixelRect(left, top, right, bottom);
        return true;
    }

    public static bool TryCreatePanelRect(
        int viewportWidth,
        int viewportHeight,
        double scale,
        double panelWidth,
        double panelHeight,
        out NativePixelRect rect,
        double margin = 10)
    {
        rect = default;
        if (!IsViewportUsable(scale, viewportWidth, viewportHeight) ||
            !double.IsFinite(panelWidth) || !double.IsFinite(panelHeight) ||
            !double.IsFinite(margin) || panelWidth <= 0 || panelHeight <= 0 || margin < 0)
            return false;

        var cssViewportWidth = viewportWidth / scale;
        var cssViewportHeight = viewportHeight / scale;
        var leftCss = cssViewportWidth - panelWidth - margin;
        var topCss = margin;
        var rightCss = leftCss + panelWidth;
        var bottomCss = Math.Min(cssViewportHeight - margin, topCss + panelHeight);

        var left = ClampPixel(Math.Floor(leftCss * scale), viewportWidth);
        var top = ClampPixel(Math.Floor(topCss * scale), viewportHeight);
        var right = ClampPixel(Math.Ceiling(rightCss * scale), viewportWidth);
        var bottom = ClampPixel(Math.Ceiling(bottomCss * scale), viewportHeight);

        if (right - left < 2 || bottom - top < 2) return false;
        rect = new NativePixelRect(left, top, right, bottom);
        return true;
    }

    private static bool IsViewportUsable(double scale, int width, int height) =>
        double.IsFinite(scale) && scale >= MinimumScale && scale <= MaximumScale &&
        width >= 2 && height >= 2;

    private static int ClampPixel(double value, int limit)
    {
        if (double.IsNaN(value)) return 0;
        if (value <= 0) return 0;
        if (value >= limit) return limit;
        return (int)value;
    }
}
