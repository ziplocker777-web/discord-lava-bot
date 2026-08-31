const express = require("express");
const { addPreset } = require("./presetsStore");
const { registerPresetsApi } = require("./presetsApi");

addPreset({
    name: "Cold White Muzzle",
    submittedBy: "111111111",
    data: JSON.parse('{"Global":{"Flash":1,"FlashEmission":6,"SparksEmissive":30,"SmokeDensityMult":1,"TracerEnabled":true,"TracerSize":{"Min":1,"Max":1},"TracerColorHex":"#3D8EFF","TracerEmission":100,"TracerSmoke":false,"TracerSmokeSize":1,"BarrelEnabled":true,"BarrelSize":{"Min":1,"Max":1},"BarrelDensityMult":1,"BarrelOpacity":1.4,"EjectSmokeEnabled":true,"DistortionEnabled":true,"BloodSize":{"Min":1,"Max":1},"BloodCount":{"Min":1,"Max":1}},"Categories":{"Pistol":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"SMG":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"AssaultRifle":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"ShotgunSniper":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1}}}'),
});

addPreset({
    name: "Heavy Sparks AR Setup",
    submittedBy: "222222222",
    data: JSON.parse('{"Global":{"Flash":4,"FlashEmission":3,"SparksEmissive":60,"SmokeDensityMult":1,"TracerEnabled":true,"TracerSize":{"Min":1,"Max":1},"TracerColorHex":"#FFFFFF","TracerEmission":100,"TracerSmoke":false,"TracerSmokeSize":1,"BarrelEnabled":true,"BarrelSize":{"Min":1,"Max":1},"BarrelDensityMult":1,"BarrelOpacity":1,"EjectSmokeEnabled":true,"DistortionEnabled":true,"BloodSize":{"Min":1,"Max":1},"BloodCount":{"Min":1,"Max":1}},"Categories":{"Pistol":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"SMG":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"AssaultRifle":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1.5,"Max":2.2},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"ShotgunSniper":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1}}}'),
});

addPreset({
    name: "No Flash — Stealth",
    submittedBy: "333333333",
    data: JSON.parse('{"Global":{"Flash":6,"FlashEmission":1,"SparksEmissive":30,"SmokeDensityMult":1,"TracerEnabled":false,"TracerSize":{"Min":1,"Max":1},"TracerColorHex":"#FFFFFF","TracerEmission":100,"TracerSmoke":false,"TracerSmokeSize":1,"BarrelEnabled":false,"BarrelSize":{"Min":1,"Max":1},"BarrelDensityMult":1,"BarrelOpacity":1,"EjectSmokeEnabled":false,"DistortionEnabled":true,"BloodSize":{"Min":1,"Max":1},"BloodCount":{"Min":1,"Max":1}},"Categories":{"Pistol":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"SMG":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"AssaultRifle":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1},"ShotgunSniper":{"FlashSize":{"Min":1,"Max":1},"SparksEnabled":true,"SparksSize":{"Min":1,"Max":1},"SparksCount":{"Min":1,"Max":1},"SmokeEnabled":true,"SmokeSize":{"Min":1,"Max":1},"SmokeOpacity":1}}}'),
});

const app = express();
app.use(express.json());
registerPresetsApi(app);
app.listen(38219, () => console.log("Preview server with 3 sample presets on 38219"));
