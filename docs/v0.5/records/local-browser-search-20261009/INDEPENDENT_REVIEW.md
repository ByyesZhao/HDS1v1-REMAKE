# 独立整批复核原报告

基线889805d→687188c；f82b4ef仅文档。审查者image_search_final_review，2026-10-10。原判断 Ready: No，3 Important，0 Critical／Minor；以下保留修复前结论。没有二次复核。

1. token-only OneBot images never reach platform resolver. assets.ts:18 skips callback when sourceUrl is nonempty token; plugin-runtime.ts:81 calls bot.getImage but installed OneBot exposes bot.internal.getImage. Offline reproduction of <img src="opaque.image" file="opaque.image"/> returned unavailable, bridgeCalls0; installed prototype inspected.
2. navigation/loading shells accepted as article body. extract.ts:24 accepts any nonempty main/article. Offline <main><a href="/">Home</a><a href="/news">News</a></main> returned HomeNews; status-only main returned Loading article...; port stops polling/cache counts success.
3. popup pages escape drain. koishi-port.ts:15 fire-and-forget popup.close and swallows failure. Offline gated popup close allowed managed.dispose resolve while popupClosed=false; permits new instance with unresolved owned pages.

Fix recommendations: actual OneBot bridge+token normalization and runtime assembly regression; structural non-navigation evidence+dynamic shell regression preserving short body; track popup closure with parent drain, propagate failure unless known closed/disconnected, test delayed/rejected closure.

Review ran isolated offline reproductions, no formal runtime/network; attempted11 existing test files failed before executing due Vitest spawn EPERM (review sandbox), not test assertion failure. Working tree/source/index/HEAD untouched. Declined to judge []；online model quality/real QQ/months outside read-only scope.

修复后关闭与红绿验收另存FINAL_REVIEW_CLOSURE，不改本报告原结论。
