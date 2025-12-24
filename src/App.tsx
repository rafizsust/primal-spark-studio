import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";

import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ReadingTestList from "./pages/ReadingTestList";
import ReadingTest from "./pages/ReadingTest";
import ListeningTestList from "./pages/ListeningTestList";
import ListeningTest from "./pages/ListeningTest";
import WritingTestList from "./pages/WritingTestList";
import WritingTest from "./pages/WritingTest";
import WritingEvaluationReport from "./pages/WritingEvaluationReport";
import SpeakingTestList from "./pages/SpeakingTestList";
import SpeakingTest from "./pages/SpeakingTest";
import SpeakingEvaluationReport from "./pages/SpeakingEvaluationReport";
import TestResults from "./pages/TestResults";
import Analytics from "./pages/Analytics";
import AnalyticsDemo from "./pages/AnalyticsDemo";
import Flashcards from "./pages/Flashcards";
import PassageStudy from "./pages/PassageStudy";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import Onboarding from "./pages/Onboarding";
import PromotionCodesAdmin from "./pages/admin/PromotionCodesAdmin";
import FullMockTest from "./pages/FullMockTest";
import GenerateListeningPOC from "./pages/GenerateListeningPOC";
import TestComparison from "./pages/TestComparison";
import AIPractice from "./pages/AIPractice";
import AIPracticeTest from "./pages/AIPracticeTest";
import AIPracticeResults from "./pages/AIPracticeResults";
import AIPracticeWritingTest from "./pages/AIPracticeWritingTest";
import AIPracticeSpeakingTest from "./pages/AIPracticeSpeakingTest";
import AIPracticeReadingTest from "./pages/AIPracticeReadingTest";
import AIPracticeListeningTest from "./pages/AIPracticeListeningTest";
// Admin pages
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ReadingTestsAdmin from "./pages/admin/ReadingTestsAdmin";
import ReadingTestEditor from "./pages/admin/ReadingTestEditor";
import ListeningTestsAdmin from "./pages/admin/ListeningTestsAdmin";
import ListeningTestEditor from "./pages/admin/ListeningTestEditor";
import WritingTestsAdmin from "./pages/admin/WritingTestsAdmin";
import WritingTestEditor from "./pages/admin/WritingTestEditor";
import SpeakingTestsAdmin from "./pages/admin/SpeakingTestsAdmin";
import SpeakingTestEditor from "./pages/admin/SpeakingTestEditor";


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner position="top-center" />
        <BrowserRouter>
          
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/reading/cambridge-ielts-a" element={<ReadingTestList />} />
            <Route path="/reading/test/:testId" element={<ReadingTest />} />
            <Route path="/reading/study/:testId" element={<PassageStudy />} />
            <Route path="/listening/cambridge-ielts-a" element={<ListeningTestList />} />
            <Route path="/listening/test/:testId" element={<ListeningTest />} />
            <Route path="/writing/cambridge-ielts-a" element={<WritingTestList />} />
            <Route path="/writing/test/:testId" element={<WritingTest />} />
            <Route path="/writing/test/:testId/new-submission" element={<WritingTest />} />
            <Route path="/writing/evaluation/:testId/:submissionId?" element={<WritingEvaluationReport />} />
            <Route path="/speaking/cambridge-ielts-a" element={<SpeakingTestList />} />
            <Route path="/speaking/test/:testId" element={<SpeakingTest />} />
            <Route path="/speaking/test/:testId/new-submission" element={<SpeakingTest />} />
            <Route path="/speaking/test/:testId/submit-guest" element={<SpeakingTest />} />
            <Route path="/speaking/evaluation/:testId/:submissionId?" element={<SpeakingEvaluationReport />} />
            
            {/* Full Mock Test */}
            <Route path="/full-mock-test" element={<FullMockTest />} />
            
            {/* Test Results */}
            <Route path="/results/:submissionId" element={<TestResults />} />
            
            {/* Analytics & Flashcards */}
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analytics/demo" element={<AnalyticsDemo />} />
            <Route path="/flashcards" element={<Flashcards />} />
            
            {/* AI Generation POC */}
            <Route path="/generate/listening" element={<GenerateListeningPOC />} />
            
            {/* Test Comparison */}
            <Route path="/compare" element={<TestComparison />} />
            
            {/* AI Practice */}
            <Route path="/ai-practice" element={<AIPractice />} />
            <Route path="/ai-practice/test/:testId" element={<AIPracticeTest />} />
            <Route path="/ai-practice/writing/:testId" element={<AIPracticeWritingTest />} />
            <Route path="/ai-practice/speaking/:testId" element={<AIPracticeSpeakingTest />} />
            <Route path="/ai-practice/results/:testId" element={<AIPracticeResults />} />
            {/* Admin Routes */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="reading" element={<ReadingTestsAdmin />} />
              <Route path="reading/new" element={<ReadingTestEditor />} />
              <Route path="reading/edit/:testId" element={<ReadingTestEditor />} />
              <Route path="listening" element={<ListeningTestsAdmin />} />
              <Route path="listening/new" element={<ListeningTestEditor />} />
              <Route path="listening/edit/:testId" element={<ListeningTestEditor />} />
              <Route path="writing" element={<WritingTestsAdmin />} />
              <Route path="writing/new" element={<WritingTestEditor />} />
              <Route path="writing/edit/:testId" element={<WritingTestEditor />} />
              <Route path="speaking" element={<SpeakingTestsAdmin />} />
              <Route path="speaking/new" element={<SpeakingTestEditor />} />
              <Route path="speaking/edit/:testId" element={<SpeakingTestEditor />} />
              <Route path="promotions" element={<PromotionCodesAdmin />} />
            </Route>
            
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;