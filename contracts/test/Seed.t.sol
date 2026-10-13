// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AriaClearing} from "../src/AriaClearing.sol";
import {IAriaClearing} from "../src/IAriaClearing.sol";
import {Claims} from "../script/Claims.sol";
import {Seed} from "../script/Seed.s.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract SeedHarness is Seed {
    function seedAll(AriaClearing clearing, string memory json) external returns (uint256) {
        return _seed(clearing, json);
    }
}

contract SeedTest is Test {
    // claimsHash(formatClaims(claims)) from receipt/src/hash.ts, per campaign in campaigns.json.
    bytes32 internal constant TS_LISBON = 0x634e8eac17109760497d301344f5e7e7a4118d887b8b0b66a7b1ab8ed3ec208a;
    bytes32 internal constant TS_AGENCY = 0xbe1bec9a9be09541b9beb1f8c6c9b0f305cf23fcd7007123f262c4ce348dd39d;
    bytes32 internal constant TS_ALPINE = 0xfc2cf05ea4ba5bbaca286c9f89e6902b70591a9b19872df1d6f30ab18ef7ac5f;
    bytes32 internal constant TS_LANGUAGE = 0x017fe6c500674d1ac9c4c40ed9764622d10fb9b171e72c6018bcd86ebcbe7496;

    string internal json;
    MockUSDC internal usdc;
    AriaClearing internal clearing;
    SeedHarness internal seeder;

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/script/campaigns.json"));
        usdc = new MockUSDC();
        clearing = new AriaClearing(
            address(usdc), makeAddr("relayer"), makeAddr("forwarder"), 20, 2000, makeAddr("feeRecipient")
        );
        seeder = new SeedHarness();
        usdc.mint(address(seeder), 100_000_000);
    }

    function test_format_numbersLinesWithoutTrailingNewline() public pure {
        string[] memory claims = new string[](2);
        claims[0] = "Kids under 6 stay free.";
        claims[1] = "Free cancellation up to 48 hours.";
        assertEq(Claims.format(claims), "1. Kids under 6 stay free.\n2. Free cancellation up to 48 hours.");
    }

    function test_lisbonClaimsHash_matchesReceiptLibrary() public view {
        string[] memory claims = vm.parseJsonStringArray(json, "$[0].claims");
        assertEq(vm.parseJsonString(json, "$[0].slug"), "lisbon-family-trips");
        assertEq(keccak256(bytes(Claims.format(claims))), TS_LISBON);
    }

    function test_seed_createsEveryCampaignWithReceiptHashes() public {
        uint256 created = seeder.seedAll(clearing, json);
        assertEq(created, 14);

        bytes32[4] memory expected = [TS_LISBON, TS_AGENCY, TS_ALPINE, TS_LANGUAGE];
        string[4] memory slugs =
            ["lisbon-family-trips", "agency-project-planner", "alpine-hiking-gear", "language-coach"];
        for (uint256 i; i < 4; ++i) {
            IAriaClearing.Campaign memory c = clearing.campaign(keccak256(bytes(slugs[i])));
            assertEq(c.advertiser, address(seeder));
            assertEq(c.claimsHash, expected[i]);
            assertEq(c.priceImpression, 10_000);
            assertEq(c.priceClick, 250_000);
            assertEq(c.available, 4_000_000);
        }
        assertEq(usdc.balanceOf(address(clearing)), 31_000_000);
    }

    function test_seed_emitsClaimsText() public {
        string[] memory claims = vm.parseJsonStringArray(json, "$[0].claims");
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.CampaignCreated(
            keccak256("lisbon-family-trips"),
            address(seeder),
            Claims.format(claims),
            TS_LISBON,
            10_000,
            250_000,
            4_000_000
        );
        seeder.seedAll(clearing, json);
    }

    function test_seed_skipsExistingCampaigns() public {
        seeder.seedAll(clearing, json);
        assertEq(seeder.seedAll(clearing, json), 0);
        assertEq(usdc.balanceOf(address(clearing)), 31_000_000);
    }
}
