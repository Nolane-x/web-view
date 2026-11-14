using System;
using System.IO;
using System.Runtime.InteropServices;

namespace Nolane.DesktopHost;

/// <summary>
/// Owns the Windows Shell Common Item Dialog COM interop used for portable Library backups.
/// Kept outside MainWindow so WinUI XAML type discovery never reflects COM-import interfaces.
/// </summary>
internal static class WindowsShellFilePicker
{
    private static readonly Guid SaveClientGuid = new("D1E8F7A4-8B3C-4E6B-91C8-7A2D5E0F3411");
    private static readonly Guid OpenClientGuid = new("7A5B2D91-4F6C-48A3-B8D2-1E9F6C0A5274");
    private static readonly Guid FileOpenDialogClassId = new("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7");
    private static readonly Guid FileSaveDialogClassId = new("C0B4E2F3-BA21-4773-8DBA-335EC946EB8B");

    public static string? PickLibraryBackupPath(IntPtr ownerWindow, bool save)
    {
        if (ownerWindow == IntPtr.Zero)
            throw new ArgumentException("A valid owner window handle is required.", nameof(ownerWindow));

        var classId = save ? FileSaveDialogClassId : FileOpenDialogClassId;
        var dialogType = Type.GetTypeFromCLSID(classId, throwOnError: true)
            ?? throw new InvalidOperationException("The Windows Shell file dialog is unavailable.");
        var dialogObject = Activator.CreateInstance(dialogType)
            ?? throw new InvalidOperationException("Windows could not create the file dialog.");

        try
        {
            var dialog = (IFileDialog)dialogObject;
            dialog.SetTitle(save ? "Export Nolane Library" : "Import Nolane Library backup");
            dialog.SetOkButtonLabel(save ? "Export backup" : "Validate backup");
            dialog.SetFileTypes(1, new[]
            {
                new FilterSpec { Name = "Nolane Library backup (*.json)", Spec = "*.json" }
            });
            dialog.SetFileTypeIndex(1);
            dialog.SetDefaultExtension("json");
            var clientGuid = save ? SaveClientGuid : OpenClientGuid;
            dialog.SetClientGuid(ref clientGuid);

            dialog.GetOptions(out var options);
            options |= FileDialogOptions.ForceFileSystem |
                FileDialogOptions.PathMustExist |
                FileDialogOptions.NoChangeDir;
            options |= save ? FileDialogOptions.OverwritePrompt : FileDialogOptions.FileMustExist;
            dialog.SetOptions(options);
            if (save)
                dialog.SetFileName("Nolane-Library-" + DateTime.Now.ToString("yyyyMMdd") + ".json");

            var result = dialog.Show(ownerWindow);
            const int ErrorCancelled = unchecked((int)0x800704C7);
            if (result == ErrorCancelled) return null;
            Marshal.ThrowExceptionForHR(result);

            dialog.GetResult(out var shellItem);
            try
            {
                shellItem.GetDisplayName(ShellItemDisplayName.FileSystemPath, out var pathPointer);
                try
                {
                    var path = Marshal.PtrToStringUni(pathPointer);
                    return string.IsNullOrWhiteSpace(path) ? null : Path.GetFullPath(path);
                }
                finally
                {
                    if (pathPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pathPointer);
                }
            }
            finally
            {
                if (Marshal.IsComObject(shellItem)) Marshal.ReleaseComObject(shellItem);
            }
        }
        finally
        {
            if (Marshal.IsComObject(dialogObject)) Marshal.ReleaseComObject(dialogObject);
        }
    }

    [Flags]
    private enum FileDialogOptions : uint
    {
        OverwritePrompt = 0x00000002,
        NoChangeDir = 0x00000008,
        ForceFileSystem = 0x00000040,
        PathMustExist = 0x00000800,
        FileMustExist = 0x00001000
    }

    private enum FileDialogAddPlace { Bottom, Top }
    private enum ShellItemDisplayName : uint { FileSystemPath = 0x80058000 }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct FilterSpec
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string? Name;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Spec;
    }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] FilterSpec[] filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(FileDialogOptions options);
        void GetOptions(out FileDialogOptions options);
        void SetDefaultFolder(IShellItem item);
        void SetFolder(IShellItem item);
        void GetFolder(out IShellItem item);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, FileDialogAddPlace location);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid clientGuid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(ShellItemDisplayName displayName, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }
}
