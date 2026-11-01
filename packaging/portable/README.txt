Mantel: a family wall display

1. Run start.command (Mac) or ./start.sh (Linux). Leave the window open.
2. Open http://localhost:8787 on this computer. It pairs itself and walks you through setup.
3. Put it on a tablet: open the same address, but with this computer's name or IP
   (Settings shows it), and enter your admin PIN.

Mac: the first run may be blocked because the download is not signed. Open Terminal in this
folder and run:  xattr -dr com.apple.quarantine .   then start it again.

To keep it running all the time, add start.sh to your login items (Mac) or a systemd
service (Linux): see https://github.com/sorel123/mantel/blob/main/packaging/README.md

Your settings and keys are in the data folder next to start.sh. Back it up; to update,
unpack a new version and copy the data folder across.
