// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {AriaClearing} from "../src/AriaClearing.sol";

/// @notice Deploys AriaClearing from env and, on broadcast, writes deployments/<chainId>.json.
/// Env: USDC_ADDRESS, RELAYER_ADDRESS, FORWARDER_ADDRESS, DISPUTE_WINDOW (seconds).
contract Deploy is Script {
    function run() external returns (AriaClearing clearing) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address forwarder = vm.envAddress("FORWARDER_ADDRESS");
        uint64 disputeWindow = uint64(vm.envUint("DISPUTE_WINDOW"));
        // Lower bound of the inclusion block, for indexers.
        uint256 deployBlock = block.number;

        vm.startBroadcast();
        clearing = new AriaClearing(usdc, relayer, forwarder, disputeWindow);
        vm.stopBroadcast();
        console.log("AriaClearing", address(clearing));

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            return clearing;
        }

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "address", address(clearing));
        vm.serializeUint(key, "deployBlock", deployBlock);
        vm.serializeAddress(key, "usdc", usdc);
        vm.serializeAddress(key, "relayer", relayer);
        vm.serializeAddress(key, "forwarder", forwarder);
        string memory json = vm.serializeUint(key, "disputeWindow", disputeWindow);

        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
