{
  description = "BySpace - self-hosted daemon for AI coding agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          byspace = pkgs.callPackage ./nix/package.nix { };
          versionParts = pkgs.lib.splitString "." byspace.version;
          sourceRevision = if self ? revCount && self.revCount != null then self.revCount else 0;
          buildRevision = sourceRevision - (sourceRevision / 10000) * 10000;
          desktopBuildVersion = pkgs.lib.concatStringsSep "." [
            (builtins.elemAt versionParts 0)
            (builtins.elemAt versionParts 1)
            (toString buildRevision)
          ];
        in
        {
          default = byspace;
          byspace = byspace;
          desktop = pkgs.callPackage ./nix/desktop-package.nix {
            inherit byspace;
            buildVersion = desktopBuildVersion;
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          byspace = pkgs.callPackage ./nix/package.nix { };
          source = byspace.src;
        in
        {
          package = byspace;
          source-filter = pkgs.runCommand "byspace-nix-source-filter" { } ''
            for path in \
              package.json \
              package-lock.json \
              nix/package.nix \
              patches/react-native-gesture-handler+2.28.0.patch \
              scripts/build-daemon-web-ui.mjs \
              scripts/trace-daemon.mjs \
              skills/byspace/SKILL.md \
              packages/app/public/index.html \
              packages/app/src/app/_layout.tsx \
              packages/server/src/server/orchestration-skills.ts
            do
              test -e "${source}/$path" || { echo "missing required source: $path" >&2; exit 1; }
            done

            for path in \
              docs \
              .github \
              .agents \
              .claude \
              .codex \
              docker \
              AGENTS.md \
              CONTRIBUTING.md \
              README.md \
              SECURITY.md
            do
              test ! -e "${source}/$path" || { echo "unexpected source: $path" >&2; exit 1; }
            done

            touch $out
          '';
        }
      );

      nixosModules.default = self.nixosModules.byspace;
      nixosModules.byspace =
        { pkgs, lib, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.byspace.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.python3
            ];
          };
        }
      );
    };
}
