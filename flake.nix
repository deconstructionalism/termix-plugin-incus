{
  description = "Incus plugin for Termix";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # the plugin folder as Termix loads it from $DATA_DIR/plugins/incus
      packages = forAll (pkgs: {
        default = pkgs.buildNpmPackage {
          pname = "termix-plugin-incus";
          version = (builtins.fromJSON (builtins.readFile ./manifest.json)).version;
          src = self;
          nodejs = pkgs.nodejs_24;
          npmDepsHash = "sha256-Om3WRaTPE6EwDz6fqXpsak+Il85///V133vlv+efPFU=";
          npmFlags = [ "--ignore-scripts" ];
          doCheck = true;
          checkPhase = ''
            runHook preCheck
            npm test
            npm run validate
            runHook postCheck
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r dist locales manifest.json README.md CHANGELOG.md LICENSE $out/
            runHook postInstall
          '';
        };
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell { packages = [ pkgs.nodejs_24 ]; };
      });
    };
}
