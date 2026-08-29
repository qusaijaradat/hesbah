using System.Reflection;
using QuestPDF.Drawing;

namespace GreenMarket.Api.Services;

/// <summary>
/// Registers the bundled Arabic font (Amiri, embedded in the DLL — see GreenMarket.Api.csproj)
/// under the name "Tahoma" so every existing <c>.FontFamily("Tahoma")</c> call in ExportService
/// keeps working unchanged, but now resolves to a font that actually ships with the app instead
/// of one that only exists on a Windows developer machine.
///
/// Why this was needed: invoice PDFs rendered Arabic text as "؟؟؟" in production even though it
/// looked correct locally. "Tahoma" is a Windows-only font — the API runs in a plain Linux
/// container (mcr.microsoft.com/dotnet/aspnet:8.0) that doesn't have it, so QuestPDF/SkiaSharp
/// silently fell back to whatever default font Skia could find, which has no Arabic glyphs at
/// all. Registering a real embedded font removes that dependency on the host's installed fonts
/// entirely — this now renders identically no matter where the container runs.
/// </summary>
public static class PdfFontRegistration
{
    public static void RegisterBundledFonts()
    {
        RegisterEmbeddedFont("Amiri-Regular.ttf", "Tahoma");
        RegisterEmbeddedFont("Amiri-Bold.ttf", "Tahoma");
    }

    private static void RegisterEmbeddedFont(string fileName, string registerAs)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith(fileName, StringComparison.OrdinalIgnoreCase));
        if (resourceName is null)
            throw new InvalidOperationException(
                $"Bundled font '{fileName}' not found as an embedded resource — check the " +
                "<EmbeddedResource> entries in GreenMarket.Api.csproj.");

        using var stream = assembly.GetManifestResourceStream(resourceName)!;
        FontManager.RegisterFontWithCustomName(registerAs, stream);
    }
}
