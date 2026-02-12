{
  inputs = {
    playwright-flake = {
      url = "github:pietdevries94/playwright-web-flake";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils = {url = "github:numtide/flake-utils"; };
    flake-compat = { url = "github:edolstra/flake-compat"; flake = false; };
  };

  outputs = {nixpkgs, flake-utils, playwright-flake, ...}:
  flake-utils.lib.eachDefaultSystem (system: let
    playwright = playwright-flake.packages.default;
    overlays = [
      (final: prev: {
          inherit (playwright) playwright-test playwright-driver;
      })
    ];
    pkgs = import nixpkgs { inherit system overlays; };
  in
  {
    devShells.default = pkgs.mkShell {
      packages = with pkgs; [
        gnumake
        playwright-test
      ];
      shellHook = ''
        export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
        export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
      '';
    };
  });
}
