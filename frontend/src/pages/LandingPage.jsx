import Navbar from '../components/Navbar';
import HeroSection from '../components/HeroSection';
import ProblemSection from '../components/ProblemSection';
import SolutionSection from '../components/SolutionSection';
import HowItWorks from '../components/HowItWorks';
import Capabilities from '../components/Capabilities';
import ProductionStackSection from '../components/ProductionStackSection';
import Architecture from '../components/Architecture';
import TrustSection from '../components/TrustSection';
import ClosingCTA from '../components/ClosingCTA';
import Footer from '../components/Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />
      <HeroSection />
      <ProblemSection />
      <SolutionSection />
      <HowItWorks />
      <Capabilities />
      <ProductionStackSection />
      <Architecture />
      <TrustSection />
      <ClosingCTA />
      <Footer />
    </div>
  );
}
