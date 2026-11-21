using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows.Forms;

[assembly: AssemblyTitle("아라도 숙녀들")]
[assembly: AssemblyProduct("아라도 숙녀들")]
[assembly: AssemblyDescription("세 캐릭터를 만나는 오프라인 도트 터치 게임")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class Launcher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string entry = PrepareGame();
            string browser = FindBrowser();
            if (browser == null)
            {
                Process.Start(new ProcessStartInfo(entry) { UseShellExecute = true });
                return;
            }
            string uri = new Uri(entry).AbsoluteUri;
            Process.Start(new ProcessStartInfo(browser,
                "--app=\"" + uri + "\" --window-size=1120,820 --no-first-run")
                { UseShellExecute = false });
        }
        catch (Exception error)
        {
            MessageBox.Show("아라도 숙녀들을 열 수 없습니다.\n" + error.Message, "아라도 숙녀들",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string PrepareGame()
    {
        using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("StarAtelier.Game"))
        using (SHA256 sha = SHA256.Create())
        {
            string version = BitConverter.ToString(sha.ComputeHash(resource)).Replace("-", "").Substring(0, 24);
            resource.Position = 0;
            string cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "StarAtelier", version);
            Directory.CreateDirectory(cache);
            using (ZipArchive game = new ZipArchive(resource, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry asset in game.Entries)
                {
                    if (asset.Name.Length == 0) continue;
                    string destination = Path.GetFullPath(Path.Combine(cache, asset.FullName));
                    if (!destination.StartsWith(cache + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("게임 파일 경로를 확인할 수 없습니다.");
                    FileInfo existing = new FileInfo(destination);
                    if (existing.Exists && existing.Length == asset.Length) continue;
                    Directory.CreateDirectory(existing.DirectoryName);
                    string pending = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    try
                    {
                        using (Stream source = asset.Open())
                        using (FileStream output = new FileStream(pending, FileMode.CreateNew, FileAccess.Write))
                            source.CopyTo(output);
                        if (File.Exists(destination)) File.Replace(pending, destination, null);
                        else File.Move(pending, destination);
                    }
                    catch (IOException)
                    {
                        // Another instance may have finished installing this asset first.
                        existing.Refresh();
                        if (!existing.Exists || existing.Length != asset.Length) throw;
                    }
                    finally
                    {
                        if (File.Exists(pending)) File.Delete(pending);
                    }
                }
            }
            return Path.Combine(cache, "index.html");
        }
    }

    private static string FindBrowser()
    {
        string[] roots = {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        foreach (string relative in new[] { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" })
        {
            foreach (string root in roots)
            {
                string path = Path.Combine(root, relative);
                if (File.Exists(path)) return path;
            }
        }
        return null;
    }
}
