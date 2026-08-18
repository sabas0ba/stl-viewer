{
  description = "stl-viewer: 単一 HTML の STL ビューア";

  # nixpkgs のリビジョンは flake.lock で固定する。
  # 初回のみ `nix flake update` を実行して flake.lock をコミットすること。
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 pkgs.git ];

          # 結合テスト (playwright) は nixpkgs 側の Chromium を使い、
          # postinstall でのブラウザ自動取得を抑止する
          env = {
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };

          shellHook = ''
            echo "stl-viewer devshell  node $(node -v)"
            echo "  node build.mjs          バンドル生成"
            echo "  node test/core.test.mjs 単体テスト"
          '';
        };
      });

      packages = forAllSystems (pkgs: {
        default = pkgs.stdenv.mkDerivation {
          pname = "stl-viewer";
          version = "1.0.0";
          src = ./.;
          nativeBuildInputs = [ pkgs.nodejs_22 ];
          dontConfigure = true;
          buildPhase = ''
            runHook preBuild
            node test/core.test.mjs
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/stl-viewer
            node build.mjs $out/share/stl-viewer/index.html
            runHook postInstall
          '';
        };
      });
    };
}
