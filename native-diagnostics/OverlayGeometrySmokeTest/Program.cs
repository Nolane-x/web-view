using Nolane.DesktopHost;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static void Rect(
    bool expected,
    double x, double y, double clipX, double clipY, double clipWidth, double clipHeight,
    double scale, int viewportWidth, int viewportHeight,
    int left = 0, int top = 0, int right = 0, int bottom = 0)
{
    var actual = OverlayGeometry.TryCreateSurfaceRect(
        x, y, clipX, clipY, clipWidth, clipHeight, scale, viewportWidth, viewportHeight, out var rect);
    Check(actual == expected, $"Surface rectangle result mismatch: expected {expected}, received {actual}.");
    if (!expected) return;
    Check(rect == new NativePixelRect(left, top, right, bottom),
        $"Surface rectangle mismatch: expected [{left},{top},{right},{bottom}], received [{rect.Left},{rect.Top},{rect.Right},{rect.Bottom}].");
}

Rect(true, 100, 50, 20, 10, 200, 100, 1, 1200, 800, 120, 60, 320, 160);
Rect(true, 10, 20, 2, 1, 10.2, 5.1, 1.5, 1600, 1000, 18, 31, 34, 40);
Rect(true, -80, -30, 0, 0, 200, 120, 1.25, 1000, 600, 0, 0, 150, 113);
Rect(true, 850, 50, 0, 0, 400, 100, 1, 1000, 600, 850, 50, 1000, 150);
Rect(false, 1000, 0, 0, 0, 100, 100, 1, 1000, 600);
Rect(false, 10, 10, 0, 0, 1.2, 80, 1, 1000, 600);
Rect(false, 10, 10, 0, 0, 100, 100, double.NaN, 1000, 600);
Rect(false, 10, 10, 0, 0, 100, 100, 1, 0, 600);

Check(
    OverlayGeometry.TryCreatePanelRect(1800, 1200, 1.5, 400, 500, out var panel) &&
    panel == new NativePixelRect(585, 15, 1185, 765),
    "Right-side panel rectangle was not aligned at 150% DPI.");

Check(
    OverlayGeometry.TryCreatePanelRect(800, 500, 1, 1200, 600, out var narrowPanel) &&
    narrowPanel.Left == 0 && narrowPanel.Top == 10 && narrowPanel.Right == 800 && narrowPanel.Bottom == 490,
    "A panel wider/taller than the viewport must be clipped to the viewport.");

Check(
    !OverlayGeometry.TryCreatePanelRect(800, 500, 0, 300, 300, out _),
    "Panel rectangles must reject invalid scale.");

Console.WriteLine("PASS: native overlay clipping, negative canvas positions, viewport edges, DPI scaling and panel bounds.");
