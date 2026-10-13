// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm, console} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AriaClearing} from "../src/AriaClearing.sol";
import {IAriaClearing} from "../src/IAriaClearing.sol";
import {IReceiver} from "../src/IReceiver.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AriaClearingTest is Test {
    uint64 internal constant WINDOW = 20;
    uint256 internal constant PRICE_IMPRESSION = 10_000;
    uint256 internal constant PRICE_CLICK = 250_000;
    uint256 internal constant BUDGET = 4_000_000;
    uint256 internal constant START = 1_000_000;
    uint16 internal constant FEE_BPS = 2000;
    uint256 internal constant FEE_IMPRESSION = 2_000;
    uint256 internal constant NET_IMPRESSION = 8_000;
    uint256 internal constant FEE_CLICK = 50_000;

    bytes32 internal constant CAMPAIGN = keccak256("lisbon-family-trips");
    string internal constant CLAIMS = "1. Kids under 6 stay free.\n2. Free cancellation up to 48 hours.";
    string internal constant RATIONALE = "Great for families: kids under 6 stay free.";
    string internal constant REQUEST = "req_abc123";

    // Values computed by receipt/src/hash.ts (cast-checked there).
    bytes32 internal constant TS_CLAIMS_HASH = 0x155c6c5caa210804e80f17afd5b90251921b46868651c55819fa764c2fd024e0;
    bytes32 internal constant TS_RATIONALE_HASH = 0xd55ffa3ba90048d34cdd0874a6ba579e469c1bf06c315535d4ba43942701decd;
    bytes32 internal constant TS_REQUEST_KEY = 0xb6a2cb77e9c8c6f1ed8226260e11fea17273014ee60eae7644bfff9bf9b3fa6f;
    bytes32 internal constant TS_EVENT_ID_IMPRESSION =
        0x673bf8a383caa51748da8ca62a2121fc3744beccd9cb0e19626d01ae5ca87d42;
    bytes32 internal constant TS_EVENT_ID_CLICK = 0x69edfc15efb6e739388682ec01a3a55eb59d47e8c08765dde2c2a02d68b63503;
    bytes32 internal constant TS_LISBON_CAMPAIGN_ID =
        0xebe836eea8bdd51ca542ca8da86d4d6bb1072dd47e7a319e57660019c6ded33f;

    MockUSDC internal usdc;
    AriaClearing internal clearing;

    address internal relayer = makeAddr("relayer");
    address internal forwarder = makeAddr("forwarder");
    address internal advertiser = makeAddr("advertiser");
    address internal publisher = makeAddr("publisher");
    address internal stranger = makeAddr("stranger");
    address internal feeRecipient = makeAddr("feeRecipient");

    bytes internal metadata = new bytes(64);

    function setUp() public {
        vm.warp(START);
        usdc = new MockUSDC();
        clearing = new AriaClearing(address(usdc), relayer, forwarder, WINDOW, FEE_BPS, feeRecipient);

        usdc.mint(advertiser, BUDGET * 10);
        vm.startPrank(advertiser);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.createCampaign(CAMPAIGN, CLAIMS, PRICE_IMPRESSION, PRICE_CLICK, BUDGET);
        vm.stopPrank();
    }

    // ---------- helpers ----------

    function _refs() internal pure returns (uint8[] memory refs) {
        refs = new uint8[](2);
        refs[0] = 1;
        refs[1] = 2;
    }

    function _log(string memory requestId, IAriaClearing.Kind kind) internal returns (bytes32) {
        vm.prank(relayer);
        return clearing.logEvent(requestId, CAMPAIGN, publisher, kind, RATIONALE, _refs());
    }

    function _logImpression(string memory requestId) internal returns (bytes32) {
        return _log(requestId, IAriaClearing.Kind.Impression);
    }

    function _one(bytes32 id) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = id;
    }

    function _none() internal pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function _report(uint64 reportedAt, bytes32[] memory release, bytes32[] memory reject) internal {
        vm.prank(forwarder);
        clearing.onReport(metadata, abi.encode(reportedAt, release, reject));
    }

    function _afterWindow() internal {
        vm.warp(vm.getBlockTimestamp() + WINDOW);
    }

    function _status(bytes32 id) internal view returns (IAriaClearing.Status) {
        return clearing.clearingEvent(id).status;
    }

    /// @dev Event ids of the EventSettled logs emitted by the clearing contract, in order.
    function _settledIds(Vm.Log[] memory logs) internal view returns (bytes32[] memory ids) {
        uint256 n;
        for (uint256 i; i < logs.length; ++i) {
            if (_isSettled(logs[i])) ++n;
        }
        ids = new bytes32[](n);
        n = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (_isSettled(logs[i])) ids[n++] = logs[i].topics[1];
        }
    }

    function _isSettled(Vm.Log memory log) private view returns (bool) {
        return log.emitter == address(clearing) && log.topics[0] == IAriaClearing.EventSettled.selector;
    }

    // ---------- constructor and views ----------

    function test_constructor_setsRoles() public view {
        assertEq(clearing.usdc(), address(usdc));
        assertEq(clearing.relayer(), relayer);
        assertEq(clearing.forwarder(), forwarder);
        assertEq(clearing.disputeWindow(), WINDOW);
        assertEq(clearing.owner(), address(this));
        assertEq(clearing.lastReportedAt(), 0);
        assertEq(clearing.feeBps(), FEE_BPS);
        assertEq(clearing.feeRecipient(), feeRecipient);
        assertEq(clearing.fees(), 0);
    }

    function test_constructor_acceptsFeeCap() public {
        AriaClearing c = new AriaClearing(address(usdc), relayer, forwarder, WINDOW, 3000, feeRecipient);
        assertEq(c.feeBps(), 3000);
    }

    function test_constructor_revertsAboveFeeCap() public {
        vm.expectRevert(IAriaClearing.FeeTooHigh.selector);
        new AriaClearing(address(usdc), relayer, forwarder, WINDOW, 3001, feeRecipient);
    }

    function test_constructor_revertsZeroFeeRecipient() public {
        vm.expectRevert(IAriaClearing.InvalidFeeRecipient.selector);
        new AriaClearing(address(usdc), relayer, forwarder, WINDOW, FEE_BPS, address(0));
    }

    function test_eventIdOf_matchesReceiptLibrary() public view {
        assertEq(clearing.eventIdOf(REQUEST, IAriaClearing.Kind.Impression), TS_EVENT_ID_IMPRESSION);
        assertEq(clearing.eventIdOf(REQUEST, IAriaClearing.Kind.Click), TS_EVENT_ID_CLICK);
    }

    function test_campaignId_matchesReceiptLibrary() public pure {
        assertEq(CAMPAIGN, TS_LISBON_CAMPAIGN_ID);
    }

    // ---------- createCampaign ----------

    function test_createCampaign_pullsBudgetAndStoresState() public view {
        IAriaClearing.Campaign memory c = clearing.campaign(CAMPAIGN);
        assertEq(c.advertiser, advertiser);
        assertEq(c.claimsHash, TS_CLAIMS_HASH);
        assertEq(c.priceImpression, PRICE_IMPRESSION);
        assertEq(c.priceClick, PRICE_CLICK);
        assertEq(c.available, BUDGET);
        assertEq(c.reserved, 0);
        assertEq(usdc.balanceOf(address(clearing)), BUDGET);
    }

    function test_createCampaign_emitsClaimsText() public {
        bytes32 id = keccak256("second");
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.CampaignCreated(
            id, advertiser, CLAIMS, TS_CLAIMS_HASH, PRICE_IMPRESSION, PRICE_CLICK, BUDGET
        );
        vm.prank(advertiser);
        clearing.createCampaign(id, CLAIMS, PRICE_IMPRESSION, PRICE_CLICK, BUDGET);
    }

    function test_createCampaign_revertsIfExists() public {
        vm.prank(advertiser);
        vm.expectRevert(IAriaClearing.CampaignExists.selector);
        clearing.createCampaign(CAMPAIGN, CLAIMS, PRICE_IMPRESSION, PRICE_CLICK, BUDGET);
    }

    // ---------- logEvent ----------

    function test_logEvent_reservesPriceAndEmitsReceipt() public {
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.EventLogged(
            TS_EVENT_ID_IMPRESSION,
            TS_REQUEST_KEY,
            CAMPAIGN,
            REQUEST,
            publisher,
            IAriaClearing.Kind.Impression,
            RATIONALE,
            TS_RATIONALE_HASH,
            _refs(),
            PRICE_IMPRESSION
        );
        bytes32 id = _logImpression(REQUEST);

        assertEq(id, TS_EVENT_ID_IMPRESSION);
        IAriaClearing.ClearingEvent memory e = clearing.clearingEvent(id);
        assertEq(e.campaignId, CAMPAIGN);
        assertEq(e.publisher, publisher);
        assertEq(uint8(e.kind), uint8(IAriaClearing.Kind.Impression));
        assertEq(uint8(e.status), uint8(IAriaClearing.Status.Logged));
        assertEq(e.loggedAt, START);
        assertEq(e.price, PRICE_IMPRESSION);

        IAriaClearing.Campaign memory c = clearing.campaign(CAMPAIGN);
        assertEq(c.available, BUDGET - PRICE_IMPRESSION);
        assertEq(c.reserved, PRICE_IMPRESSION);
    }

    function test_logEvent_clickUsesClickPrice() public {
        bytes32 id = _log(REQUEST, IAriaClearing.Kind.Click);
        assertEq(id, TS_EVENT_ID_CLICK);
        assertEq(clearing.clearingEvent(id).price, PRICE_CLICK);
        assertEq(clearing.campaign(CAMPAIGN).reserved, PRICE_CLICK);
    }

    function test_logEvent_impressionAndClickOfSameRequestAreDistinct() public {
        bytes32 a = _log(REQUEST, IAriaClearing.Kind.Impression);
        bytes32 b = _log(REQUEST, IAriaClearing.Kind.Click);
        assertTrue(a != b);
        assertEq(clearing.campaign(CAMPAIGN).reserved, PRICE_IMPRESSION + PRICE_CLICK);
    }

    function test_logEvent_revertsIfNotRelayer() public {
        vm.prank(stranger);
        vm.expectRevert(IAriaClearing.NotRelayer.selector);
        clearing.logEvent(REQUEST, CAMPAIGN, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
    }

    function test_logEvent_revertsAlreadyLogged() public {
        _logImpression(REQUEST);
        vm.prank(relayer);
        vm.expectRevert(IAriaClearing.AlreadyLogged.selector);
        clearing.logEvent(REQUEST, CAMPAIGN, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
    }

    function test_logEvent_revertsAlreadyLoggedAfterSettlement() public {
        bytes32 id = _logImpression(REQUEST);
        _afterWindow();
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());
        vm.prank(relayer);
        vm.expectRevert(IAriaClearing.AlreadyLogged.selector);
        clearing.logEvent(REQUEST, CAMPAIGN, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
    }

    function test_logEvent_revertsUnknownCampaign() public {
        vm.prank(relayer);
        vm.expectRevert(IAriaClearing.UnknownCampaign.selector);
        clearing.logEvent(REQUEST, keccak256("nope"), publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
    }

    function test_logEvent_revertsInsufficientBudget() public {
        bytes32 small = keccak256("small");
        vm.prank(advertiser);
        clearing.createCampaign(small, CLAIMS, PRICE_IMPRESSION, PRICE_CLICK, 15_000);

        vm.startPrank(relayer);
        clearing.logEvent("r1", small, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
        vm.expectRevert(IAriaClearing.InsufficientBudget.selector);
        clearing.logEvent("r2", small, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
        vm.stopPrank();
    }

    // ---------- pendingEvents ----------

    function test_pendingEvents_listsLoggedAndDisputedOnly() public {
        bytes32 a = _logImpression("a");
        bytes32 b = _logImpression("b");
        bytes32 c = _logImpression("c");
        vm.prank(advertiser);
        clearing.dispute(b);

        _afterWindow();
        _report(uint64(vm.getBlockTimestamp()), _one(a), _none());

        (bytes32[] memory ids, IAriaClearing.ClearingEvent[] memory events) = clearing.pendingEvents();
        assertEq(ids.length, 2);
        assertEq(events.length, 2);
        for (uint256 i; i < ids.length; ++i) {
            assertTrue(ids[i] == b || ids[i] == c);
            assertEq(
                uint8(events[i].status),
                uint8(ids[i] == b ? IAriaClearing.Status.Disputed : IAriaClearing.Status.Logged)
            );
            assertEq(events[i].campaignId, CAMPAIGN);
        }
    }

    // ---------- dispute ----------

    function test_dispute_marksDisputedAndEmits() public {
        bytes32 id = _logImpression(REQUEST);
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.EventDisputed(id);
        vm.prank(advertiser);
        clearing.dispute(id);
        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Disputed));
    }

    function test_dispute_allowedOneSecondBeforeWindowEnds() public {
        bytes32 id = _logImpression(REQUEST);
        vm.warp(START + WINDOW - 1);
        vm.prank(advertiser);
        clearing.dispute(id);
        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Disputed));
    }

    function test_dispute_revertsWhenWindowEnds() public {
        bytes32 id = _logImpression(REQUEST);
        vm.warp(START + WINDOW);
        vm.prank(advertiser);
        vm.expectRevert(IAriaClearing.NotDisputable.selector);
        clearing.dispute(id);
    }

    function test_dispute_revertsIfAlreadyDisputed() public {
        bytes32 id = _logImpression(REQUEST);
        vm.startPrank(advertiser);
        clearing.dispute(id);
        vm.expectRevert(IAriaClearing.NotDisputable.selector);
        clearing.dispute(id);
        vm.stopPrank();
    }

    function test_dispute_revertsIfNotAdvertiser() public {
        bytes32 id = _logImpression(REQUEST);
        vm.prank(stranger);
        vm.expectRevert(IAriaClearing.NotAdvertiser.selector);
        clearing.dispute(id);
    }

    function test_dispute_unknownEventRevertsNotAdvertiser() public {
        vm.prank(advertiser);
        vm.expectRevert(IAriaClearing.NotAdvertiser.selector);
        clearing.dispute(keccak256("unknown"));
    }

    // ---------- onReport ----------

    function test_onReport_revertsIfNotForwarder() public {
        vm.prank(stranger);
        vm.expectRevert(IAriaClearing.NotForwarder.selector);
        clearing.onReport(metadata, abi.encode(uint64(1), _none(), _none()));
    }

    function test_release_paysPublisherDirectly() public {
        bytes32 id = _logImpression(REQUEST);
        _afterWindow();

        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.EventSettled(id, IAriaClearing.Status.Released);
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.PaidOut(id, publisher, NET_IMPRESSION, FEE_IMPRESSION);
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());

        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Released));
        assertEq(usdc.balanceOf(publisher), NET_IMPRESSION);
        assertEq(usdc.balanceOf(address(clearing)), BUDGET - NET_IMPRESSION);
        assertEq(clearing.credit(publisher), 0);
        assertEq(clearing.fees(), FEE_IMPRESSION);
        assertEq(clearing.campaign(CAMPAIGN).reserved, 0);
        assertEq(clearing.campaign(CAMPAIGN).available, BUDGET - PRICE_IMPRESSION);
        assertEq(clearing.lastReportedAt(), vm.getBlockTimestamp());

        vm.prank(publisher);
        vm.expectRevert(IAriaClearing.NothingToClaim.selector);
        clearing.claim();
    }

    function test_release_failedTransferDefersToCreditThenClaim() public {
        bytes32 id = _logImpression(REQUEST);
        _afterWindow();
        usdc.setTransferFails(publisher, true);

        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.EventSettled(id, IAriaClearing.Status.Released);
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.PayoutDeferred(id, publisher, NET_IMPRESSION, FEE_IMPRESSION);
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());

        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Released));
        assertEq(usdc.balanceOf(publisher), 0);
        assertEq(usdc.balanceOf(address(clearing)), BUDGET);
        assertEq(clearing.credit(publisher), NET_IMPRESSION);
        assertEq(clearing.fees(), FEE_IMPRESSION);

        usdc.setTransferFails(publisher, false);
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.Claimed(publisher, NET_IMPRESSION);
        vm.prank(publisher);
        uint256 amount = clearing.claim();

        assertEq(amount, NET_IMPRESSION);
        assertEq(usdc.balanceOf(publisher), NET_IMPRESSION);
        assertEq(clearing.credit(publisher), 0);
    }

    function test_release_revertingTransferDefersToCredit() public {
        vm.prank(relayer);
        bytes32 id = clearing.logEvent(REQUEST, CAMPAIGN, address(0), IAriaClearing.Kind.Impression, RATIONALE, _refs());
        _afterWindow();

        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.PayoutDeferred(id, address(0), NET_IMPRESSION, FEE_IMPRESSION);
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());

        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Released));
        assertEq(clearing.credit(address(0)), NET_IMPRESSION);
        assertEq(clearing.fees(), FEE_IMPRESSION);
        assertEq(usdc.balanceOf(address(clearing)), BUDGET);
    }

    function test_release_failedPayoutDoesNotBlockOthers() public {
        address other = makeAddr("other");
        bytes32 failing = _logImpression("a");
        vm.prank(relayer);
        bytes32 paid = clearing.logEvent("b", CAMPAIGN, other, IAriaClearing.Kind.Impression, RATIONALE, _refs());
        bytes32 rejected = _logImpression("c");
        _afterWindow();
        usdc.setTransferFails(publisher, true);

        bytes32[] memory release = new bytes32[](2);
        release[0] = failing;
        release[1] = paid;
        _report(uint64(vm.getBlockTimestamp()), release, _one(rejected));

        assertEq(clearing.credit(publisher), NET_IMPRESSION);
        assertEq(usdc.balanceOf(other), NET_IMPRESSION);
        assertEq(clearing.credit(other), 0);
        assertEq(clearing.fees(), 2 * FEE_IMPRESSION);
        assertEq(uint8(_status(rejected)), uint8(IAriaClearing.Status.Rejected));
        assertEq(clearing.campaign(CAMPAIGN).available, BUDGET - 2 * PRICE_IMPRESSION);
        assertEq(clearing.campaign(CAMPAIGN).reserved, 0);
    }

    function test_reject_refundsCampaign() public {
        bytes32 id = _log(REQUEST, IAriaClearing.Kind.Click);
        _afterWindow();

        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.EventSettled(id, IAriaClearing.Status.Rejected);
        _report(uint64(vm.getBlockTimestamp()), _none(), _one(id));

        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Rejected));
        assertEq(clearing.credit(publisher), 0);
        assertEq(clearing.campaign(CAMPAIGN).reserved, 0);
        assertEq(clearing.campaign(CAMPAIGN).available, BUDGET);
        assertEq(clearing.fees(), 0);
        assertEq(usdc.balanceOf(address(clearing)), BUDGET);
    }

    function test_disputed_isRefundedEvenInReleaseList() public {
        bytes32 inRelease = _logImpression("a");
        bytes32 inReject = _logImpression("b");
        vm.startPrank(advertiser);
        clearing.dispute(inRelease);
        clearing.dispute(inReject);
        vm.stopPrank();
        _afterWindow();

        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.EventSettled(inRelease, IAriaClearing.Status.Rejected);
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.EventSettled(inReject, IAriaClearing.Status.Rejected);
        _report(uint64(vm.getBlockTimestamp()), _one(inRelease), _one(inReject));

        assertEq(uint8(_status(inRelease)), uint8(IAriaClearing.Status.Rejected));
        assertEq(uint8(_status(inReject)), uint8(IAriaClearing.Status.Rejected));
        assertEq(clearing.credit(publisher), 0);
        assertEq(usdc.balanceOf(publisher), 0);
        assertEq(clearing.campaign(CAMPAIGN).available, BUDGET);
        assertEq(clearing.campaign(CAMPAIGN).reserved, 0);
        assertEq(clearing.fees(), 0);
        assertEq(usdc.balanceOf(address(clearing)), BUDGET);
    }

    function test_insideWindow_isSkippedThenSettlesOnLaterReport() public {
        bytes32 id = _logImpression(REQUEST);
        vm.warp(START + WINDOW - 1);

        vm.recordLogs();
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Logged));
        assertEq(clearing.lastReportedAt(), vm.getBlockTimestamp());

        vm.warp(START + WINDOW);
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());
        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Released));
        assertEq(usdc.balanceOf(publisher), NET_IMPRESSION);
    }

    function test_unknownAndSettledIds_areSkipped() public {
        bytes32 settled = _logImpression("settled");
        bytes32 fresh = _logImpression("fresh");
        _afterWindow();
        _report(uint64(vm.getBlockTimestamp()), _one(settled), _none());

        bytes32[] memory release = new bytes32[](3);
        release[0] = keccak256("unknown");
        release[1] = settled;
        release[2] = fresh;
        bytes32[] memory reject = new bytes32[](1);
        reject[0] = settled;

        vm.warp(vm.getBlockTimestamp() + 1);
        vm.recordLogs();
        _report(uint64(vm.getBlockTimestamp()), release, reject);

        bytes32[] memory settledIds = _settledIds(vm.getRecordedLogs());
        assertEq(settledIds.length, 1);
        assertEq(settledIds[0], fresh);
        assertEq(uint8(_status(settled)), uint8(IAriaClearing.Status.Released));
        assertEq(uint8(_status(fresh)), uint8(IAriaClearing.Status.Released));
        assertEq(uint8(_status(keccak256("unknown"))), uint8(IAriaClearing.Status.None));
        assertEq(usdc.balanceOf(publisher), 2 * NET_IMPRESSION);
        assertEq(clearing.fees(), 2 * FEE_IMPRESSION);
        assertEq(clearing.credit(publisher), 0);
        assertEq(clearing.campaign(CAMPAIGN).reserved, 0);
    }

    function test_idInBothLists_settlesOnce() public {
        bytes32 id = _logImpression(REQUEST);
        _afterWindow();
        vm.recordLogs();
        _report(uint64(vm.getBlockTimestamp()), _one(id), _one(id));
        assertEq(_settledIds(vm.getRecordedLogs()).length, 1);
        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Released));
        assertEq(usdc.balanceOf(publisher), NET_IMPRESSION);
        assertEq(clearing.campaign(CAMPAIGN).available, BUDGET - PRICE_IMPRESSION);
        assertEq(clearing.fees(), FEE_IMPRESSION);
    }

    function test_sameReportTwice_isNoop() public {
        bytes32 a = _logImpression("a");
        bytes32 b = _logImpression("b");
        _afterWindow();
        uint64 at = uint64(vm.getBlockTimestamp());
        _report(at, _one(a), _one(b));

        IAriaClearing.Campaign memory before = clearing.campaign(CAMPAIGN);
        uint256 balanceBefore = usdc.balanceOf(publisher);

        vm.recordLogs();
        _report(at, _one(a), _one(b));

        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(usdc.balanceOf(publisher), balanceBefore);
        assertEq(clearing.campaign(CAMPAIGN).available, before.available);
        assertEq(clearing.campaign(CAMPAIGN).reserved, before.reserved);
        assertEq(clearing.lastReportedAt(), at);
    }

    function test_staleReportedAt_isIgnored() public {
        bytes32 id = _logImpression(REQUEST);
        _afterWindow();
        _report(100, _none(), _none());
        assertEq(clearing.lastReportedAt(), 100);

        vm.recordLogs();
        _report(99, _one(id), _none());

        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(uint8(_status(id)), uint8(IAriaClearing.Status.Logged));
        assertEq(clearing.lastReportedAt(), 100);
    }

    function test_settledEvents_leavePending() public {
        bytes32 a = _logImpression("a");
        bytes32 b = _logImpression("b");
        _afterWindow();
        _report(uint64(vm.getBlockTimestamp()), _one(a), _one(b));
        (bytes32[] memory ids,) = clearing.pendingEvents();
        assertEq(ids.length, 0);
    }

    // ---------- claim ----------

    function test_claim_revertsNothingToClaim() public {
        vm.prank(publisher);
        vm.expectRevert(IAriaClearing.NothingToClaim.selector);
        clearing.claim();
    }

    // ---------- withdraw ----------

    function test_withdraw_returnsOnlyUnreservedBudget() public {
        _logImpression("a");
        bytes32 click = _log("b", IAriaClearing.Kind.Click);
        uint256 reserved = PRICE_IMPRESSION + PRICE_CLICK;
        uint256 before = usdc.balanceOf(advertiser);

        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.Withdrawn(CAMPAIGN, BUDGET - reserved);
        vm.prank(advertiser);
        uint256 amount = clearing.withdraw(CAMPAIGN);

        assertEq(amount, BUDGET - reserved);
        assertEq(usdc.balanceOf(advertiser), before + amount);
        assertEq(clearing.campaign(CAMPAIGN).available, 0);
        assertEq(clearing.campaign(CAMPAIGN).reserved, reserved);
        assertEq(usdc.balanceOf(address(clearing)), reserved);

        _afterWindow();
        _report(uint64(vm.getBlockTimestamp()), _none(), _one(click));
        vm.prank(advertiser);
        assertEq(clearing.withdraw(CAMPAIGN), PRICE_CLICK);
        assertEq(usdc.balanceOf(address(clearing)), PRICE_IMPRESSION);
    }

    function test_withdraw_revertsIfNotAdvertiser() public {
        vm.prank(stranger);
        vm.expectRevert(IAriaClearing.NotAdvertiser.selector);
        clearing.withdraw(CAMPAIGN);
    }

    function test_withdraw_withNothingAvailableReturnsZero() public {
        vm.startPrank(advertiser);
        clearing.withdraw(CAMPAIGN);
        assertEq(clearing.withdraw(CAMPAIGN), 0);
        vm.stopPrank();
    }

    // ---------- fees ----------

    function test_fee_roundsDownInPublishersFavour() public {
        bytes32 tiny = keccak256("tiny");
        vm.prank(advertiser);
        clearing.createCampaign(tiny, CLAIMS, 1, 9, 100);
        vm.startPrank(relayer);
        bytes32 one = clearing.logEvent("one", tiny, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
        bytes32 nine = clearing.logEvent("one", tiny, publisher, IAriaClearing.Kind.Click, RATIONALE, _refs());
        vm.stopPrank();
        _afterWindow();

        bytes32[] memory release = new bytes32[](2);
        release[0] = one;
        release[1] = nine;
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.PaidOut(one, publisher, 1, 0);
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.PaidOut(nine, publisher, 8, 1);
        _report(uint64(vm.getBlockTimestamp()), release, _none());

        assertEq(usdc.balanceOf(publisher), 9);
        assertEq(clearing.fees(), 1);
    }

    function test_fee_clickSplit() public {
        bytes32 id = _log(REQUEST, IAriaClearing.Kind.Click);
        _afterWindow();
        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.PaidOut(id, publisher, PRICE_CLICK - FEE_CLICK, FEE_CLICK);
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());
        assertEq(usdc.balanceOf(publisher), PRICE_CLICK - FEE_CLICK);
        assertEq(clearing.fees(), FEE_CLICK);
    }

    function test_withdrawFees_anyCallerPaysRecipient() public {
        bytes32 a = _logImpression("a");
        bytes32 b = _log("b", IAriaClearing.Kind.Click);
        _afterWindow();
        bytes32[] memory release = new bytes32[](2);
        release[0] = a;
        release[1] = b;
        _report(uint64(vm.getBlockTimestamp()), release, _none());
        uint256 accrued = FEE_IMPRESSION + FEE_CLICK;
        assertEq(clearing.fees(), accrued);

        vm.expectEmit(true, true, true, true, address(clearing));
        emit IAriaClearing.FeesWithdrawn(feeRecipient, accrued);
        vm.prank(stranger);
        uint256 amount = clearing.withdrawFees();

        assertEq(amount, accrued);
        assertEq(usdc.balanceOf(feeRecipient), accrued);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(clearing.fees(), 0);

        vm.prank(feeRecipient);
        vm.expectRevert(IAriaClearing.NothingToWithdraw.selector);
        clearing.withdrawFees();
    }

    function test_withdrawFees_revertsWithNoFees() public {
        vm.expectRevert(IAriaClearing.NothingToWithdraw.selector);
        clearing.withdrawFees();
    }

    function test_accounting_balanceMatchesLiabilities() public {
        address advertiser2 = makeAddr("advertiser2");
        address flaky = makeAddr("flaky");
        bytes32 odd = keccak256("odd-prices");
        usdc.mint(advertiser2, 1_000_000);
        vm.startPrank(advertiser2);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.createCampaign(odd, CLAIMS, 7, 333, 1_000_000);
        vm.stopPrank();

        bytes32[] memory campaigns = new bytes32[](2);
        campaigns[0] = CAMPAIGN;
        campaigns[1] = odd;
        address[] memory publishers = new address[](3);
        publishers[0] = publisher;
        publishers[1] = flaky;
        publishers[2] = address(0);

        vm.startPrank(relayer);
        bytes32 paid = clearing.logEvent("paid", CAMPAIGN, publisher, IAriaClearing.Kind.Click, RATIONALE, _refs());
        bytes32 deferred = clearing.logEvent("deferred", odd, flaky, IAriaClearing.Kind.Click, RATIONALE, _refs());
        bytes32 rejected = clearing.logEvent("rejected", odd, publisher, IAriaClearing.Kind.Click, RATIONALE, _refs());
        bytes32 disputed =
            clearing.logEvent("disputed", CAMPAIGN, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
        bytes32 reverting =
            clearing.logEvent("reverting", odd, address(0), IAriaClearing.Kind.Impression, RATIONALE, _refs());
        bytes32 pending =
            clearing.logEvent("pending", odd, publisher, IAriaClearing.Kind.Impression, RATIONALE, _refs());
        vm.stopPrank();
        _assertAccounting(campaigns, publishers);

        vm.prank(advertiser);
        clearing.dispute(disputed);
        _afterWindow();
        vm.prank(relayer);
        bytes32 late = clearing.logEvent("late", odd, publisher, IAriaClearing.Kind.Click, RATIONALE, _refs());
        usdc.setTransferFails(flaky, true);

        bytes32[] memory release = new bytes32[](5);
        release[0] = paid;
        release[1] = deferred;
        release[2] = disputed;
        release[3] = reverting;
        release[4] = late;
        _report(uint64(vm.getBlockTimestamp()), release, _one(rejected));
        _assertAccounting(campaigns, publishers);
        assertEq(uint8(_status(late)), uint8(IAriaClearing.Status.Logged));
        assertEq(uint8(_status(pending)), uint8(IAriaClearing.Status.Logged));
        assertGt(clearing.fees(), 0);

        vm.prank(advertiser2);
        clearing.withdraw(odd);
        _assertAccounting(campaigns, publishers);

        vm.prank(stranger);
        clearing.withdrawFees();
        _assertAccounting(campaigns, publishers);

        usdc.setTransferFails(flaky, false);
        vm.prank(flaky);
        clearing.claim();
        _assertAccounting(campaigns, publishers);

        _afterWindow();
        bytes32[] memory rest = new bytes32[](2);
        rest[0] = late;
        rest[1] = pending;
        _report(uint64(vm.getBlockTimestamp()), rest, _none());
        _assertAccounting(campaigns, publishers);
        assertEq(clearing.fees(), 333 * uint256(FEE_BPS) / 10_000 + 7 * uint256(FEE_BPS) / 10_000);
    }

    /// @dev usdc held == Σ(available + reserved) + Σ credit + fees.
    function _assertAccounting(bytes32[] memory campaigns, address[] memory publishers) internal view {
        uint256 owed = clearing.fees();
        for (uint256 i; i < campaigns.length; ++i) {
            IAriaClearing.Campaign memory c = clearing.campaign(campaigns[i]);
            owed += c.available + c.reserved;
        }
        for (uint256 i; i < publishers.length; ++i) {
            owed += clearing.credit(publishers[i]);
        }
        assertEq(usdc.balanceOf(address(clearing)), owed);
    }

    // ---------- forwarder admin ----------

    function test_setForwarder_ownerOnly() public {
        address next = makeAddr("next");
        vm.prank(stranger);
        vm.expectRevert(AriaClearing.NotOwner.selector);
        clearing.setForwarder(next);

        clearing.setForwarder(next);
        assertEq(clearing.forwarder(), next);

        vm.prank(forwarder);
        vm.expectRevert(IAriaClearing.NotForwarder.selector);
        clearing.onReport(metadata, abi.encode(uint64(1), _none(), _none()));
    }

    // ---------- ERC-165 ----------

    function test_supportsInterface() public view {
        bytes4 receiverId = bytes4(keccak256("onReport(bytes,bytes)"));
        assertEq(type(IReceiver).interfaceId, receiverId);
        assertTrue(clearing.supportsInterface(receiverId));
        assertTrue(clearing.supportsInterface(type(IERC165).interfaceId));
        assertTrue(clearing.supportsInterface(0x01ffc9a7));
        assertFalse(clearing.supportsInterface(0xffffffff));
        assertFalse(clearing.supportsInterface(0x12345678));
    }

    // ---------- gas ----------

    function testGas_logEvent() public {
        string memory rationale =
            "Tagus Family Travel fits a Lisbon trip with young kids: children under 6 stay free in partner hotels, and every package includes airport transfers.";
        assertGe(bytes(rationale).length, 140);
        vm.prank(relayer);
        uint256 g = gasleft();
        clearing.logEvent(
            "req_01JA2B3C4D5E6F7G8H9J0KMNPQ", CAMPAIGN, publisher, IAriaClearing.Kind.Impression, rationale, _refs()
        );
        console.log("logEvent gas (first event of a campaign)", g - gasleft());
    }

    function testGas_onReport15() public {
        bytes32[] memory release = new bytes32[](15);
        vm.startPrank(relayer);
        for (uint256 i; i < 15; ++i) {
            address p = address(uint160(0x1000 + i));
            release[i] =
                clearing.logEvent(vm.toString(i), CAMPAIGN, p, IAriaClearing.Kind.Impression, RATIONALE, _refs());
        }
        vm.stopPrank();
        _afterWindow();
        bytes memory report = abi.encode(uint64(vm.getBlockTimestamp()), release, _none());
        vm.prank(forwarder);
        uint256 g = gasleft();
        clearing.onReport(metadata, report);
        uint256 used = g - gasleft();
        console.log("onReport gas (15 releases, 15 new publishers)", used);
        // CRE writes with a 1.5M gas limit.
        assertLt(used, 1_300_000);
        (bytes32[] memory ids,) = clearing.pendingEvents();
        assertEq(ids.length, 0);
        for (uint256 i; i < 15; ++i) {
            assertEq(usdc.balanceOf(address(uint160(0x1000 + i))), NET_IMPRESSION);
        }
        assertEq(clearing.fees(), 15 * FEE_IMPRESSION);
    }

    function testGas_claim() public {
        bytes32 id = _logImpression(REQUEST);
        _afterWindow();
        usdc.setTransferFails(publisher, true);
        _report(uint64(vm.getBlockTimestamp()), _one(id), _none());
        usdc.setTransferFails(publisher, false);
        vm.prank(publisher);
        uint256 g = gasleft();
        clearing.claim();
        console.log("claim gas", g - gasleft());
    }
}
