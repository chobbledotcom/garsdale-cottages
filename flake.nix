{
  outputs = _: {
    devShells.x86_64-linux.default =
      let
        pkgs = import <nixpkgs> { };
        pnpmScripts = pkgs.symlinkJoin {
          name = "pnpm-scripts";
          paths = map (cmd: pkgs.writeShellScriptBin cmd "pnpm run ${cmd}") [
            "serve"
            "build"
            "prepare-dev"
            "sync-files"
            "watch"
            "update-pages"
            "fetch-google-reviews"
            "clean"
          ];
        };
      in
      pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_24
          pkgs.pnpm
          pnpmScripts
        ];
        shellHook = ''
          cat <<EOF

          Available commands:
           serve               - Start development server
           build               - Build the project
           prepare-dev         - Prepare development environment
           sync-files          - Synchronize files
           watch               - Watch for changes
           update-pages        - Update pages
           fetch-google-reviews - Fetch Google Maps reviews
           clean               - Clean build directory

          EOF
          pnpm install
          git pull
        '';
      };
  };
}
